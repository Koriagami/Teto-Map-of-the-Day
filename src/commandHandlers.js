/**
 * Slash command handlers for /rsc and /tc.
 * Each handler receives (interaction, ctx) where ctx provides all dependencies.
 */

export async function handleRsc(interaction, ctx) {
  await interaction.deferReply({ ephemeral: false });

  try {
    const guildId = interaction.guildId;
    if (!guildId) {
      return interaction.editReply({
        embeds: await ctx.createEmbed('This command can only be used in a server.'),
        ephemeral: true
      });
    }
    const userId = interaction.user.id;
    const respondForMapLink = interaction.options.getString('respond_for_map_link');

    const opChannelResult = await ctx.getOperatingChannel(guildId, interaction.guild, 'challenges');
    if (opChannelResult.error) {
      return interaction.editReply({
        embeds: await ctx.createEmbed(opChannelResult.error),
        ephemeral: true
      });
    }
    const opChannel = opChannelResult.channel;

    const association = await ctx.associations.get(guildId, userId);
    if (!association || !association.osuUserId) {
      return interaction.editReply({
        embeds: await ctx.createEmbed('You need to link your Discord profile to your OSU! profile first. Use `/teto link` command to do so.'),
        ephemeral: true
      });
    }

    const osuUserId = association.osuUserId;
    let beatmapId, difficulty, userScore, existingChallenge;

    if (!respondForMapLink) {
      const recentScoresData = await ctx.getUserRecentScores(osuUserId, { limit: 1, include_fails: false });
      const recentScores = Array.isArray(recentScoresData) ? recentScoresData : [];

      if (!recentScores || recentScores.length === 0) {
        return interaction.editReply({
          embeds: await ctx.createEmbed('You have no recent scores. Play a map first!'),
          ephemeral: true
        });
      }

      userScore = recentScores[0];

      if (!ctx.isValidScore(userScore)) {
        return interaction.editReply({
          embeds: await ctx.createEmbed('Invalid score data received from OSU API. Please play a map first and try again.'),
          ephemeral: true
        });
      }

      beatmapId = userScore.beatmap.id.toString();
      difficulty = userScore.beatmap.version;

      existingChallenge = await ctx.activeChallenges.getByDifficulty(guildId, beatmapId, difficulty);

      if (existingChallenge) {
        const mapTitle = await ctx.getMapTitle(userScore);
        const artist = await ctx.getMapArtist(userScore);
        const difficultyLabel = ctx.formatDifficultyLabel(mapTitle, difficulty, artist);
        const starRatingText = await ctx.formatStarRating(userScore);
        await interaction.editReply({
          embeds: await ctx.createEmbed(`There is already an active challenge for ${starRatingText}**${difficultyLabel}**.\nORA ORA! WE ARE ENTERING THE COMPETITION!`)
        });
      } else {
        const { difficultyLink, imageUrl } = await ctx.createAndPostChallenge(
          guildId, userId, osuUserId, userScore, opChannel, interaction
        );
        return interaction.editReply({
          embeds: await ctx.createEmbed(`Challenge issued for ${difficultyLink}!`, imageUrl)
        });
      }
    } else {
      if (!respondForMapLink.includes('osu.ppy.sh')) {
        return interaction.editReply({
          embeds: await ctx.createEmbed('Invalid map link. The link must contain "osu.ppy.sh".'),
          ephemeral: true
        });
      }

      const resolved = await ctx.resolveMapOrScoreLink(respondForMapLink);
      if (!resolved || !resolved.beatmapId) {
        return interaction.editReply({
          embeds: await ctx.createEmbed('Could not extract beatmap or score from the link. Use a difficulty link (e.g. osu.ppy.sh/b/123) or a score link (e.g. osu.ppy.sh/scores/123).'),
          ephemeral: true
        });
      }
      beatmapId = resolved.beatmapId;

      const scoreUserId = resolved.score?.user_id ?? resolved.score?.user?.id;
      if (resolved.score && scoreUserId != null && String(scoreUserId) === String(osuUserId)) {
        userScore = resolved.score;
      }
      if (!userScore) {
        userScore = await ctx.getUserBeatmapScore(beatmapId, osuUserId);
      }

      if (!userScore) {
        const recentScoresData = await ctx.getUserRecentScores(osuUserId, { limit: 1, include_fails: false });
        const recentScores = Array.isArray(recentScoresData) ? recentScoresData : [];

        if (!recentScores || recentScores.length === 0) {
          return interaction.editReply({
            embeds: await ctx.createEmbed('You have no score for this beatmap. Play it first!'),
            ephemeral: true
          });
        }

        userScore = recentScores[0];

        if (userScore.beatmap?.id?.toString() !== beatmapId) {
          return interaction.editReply({
            embeds: await ctx.createEmbed('You have no score for this beatmap. Play it first!'),
            ephemeral: true
          });
        }
      }

      if (!ctx.isValidScore(userScore)) {
        return interaction.editReply({
          embeds: await ctx.createEmbed('Invalid score data received from OSU API. Please try again.'),
          ephemeral: true
        });
      }

      if (!userScore.beatmap && beatmapId) {
        try {
          const beatmapData = await ctx.getBeatmap(beatmapId);
          if (beatmapData) userScore.beatmap = beatmapData;
        } catch (_) { /* ignore */ }
      }
      difficulty = userScore.beatmap?.version;
      if (!difficulty && beatmapId) {
        try {
          const b = await ctx.getBeatmap(beatmapId);
          difficulty = b?.version ?? 'Unknown';
        } catch (_) { difficulty = 'Unknown'; }
      }

      existingChallenge = await ctx.activeChallenges.getByDifficulty(guildId, beatmapId, difficulty);

      if (!existingChallenge) {
        const { difficultyLink, imageUrl, difficultyLabel } = await ctx.createAndPostChallenge(
          guildId, userId, osuUserId, userScore, opChannel, interaction
        );
        return interaction.editReply({
          embeds: await ctx.createEmbed(`Huh? Looks like we are uncontested on **${difficultyLabel}**! COME AND CHALLENGE US!`, imageUrl)
        });
      } else {
        await interaction.editReply({
          embeds: await ctx.createEmbed('ORA ORA! WE ARE ENTERING THE COMPETITION!')
        });
      }
    }

    if (!existingChallenge) {
      if (!userScore || !ctx.isValidScore(userScore)) {
        return interaction.editReply({
          embeds: await ctx.createEmbed('No valid score found. Please try again.'),
          ephemeral: true
        });
      }

      const { difficultyLink, imageUrl } = await ctx.createAndPostChallenge(
        guildId, userId, osuUserId, userScore, opChannel, interaction
      );
      return interaction.editReply({
        embeds: await ctx.createEmbed(`Challenge issued for ${difficultyLink}!`, imageUrl)
      });
    }

    let responderScore = userScore;
    if (!responderScore || responderScore.beatmap?.id?.toString() !== existingChallenge.beatmapId) {
      if (respondForMapLink) {
        responderScore = await ctx.getUserBeatmapScore(existingChallenge.beatmapId, osuUserId);

        if (!responderScore) {
          const recentScoresData = await ctx.getUserRecentScores(osuUserId, { limit: 1, include_fails: false });
          const recentScores = Array.isArray(recentScoresData) ? recentScoresData : [];

          if (!recentScores || recentScores.length === 0) {
            return interaction.editReply({
              embeds: await ctx.createEmbed('You have no score for this beatmap. Play it first!'),
              ephemeral: true
            });
          }

          responderScore = recentScores[0];

          if (responderScore.beatmap?.id?.toString() !== existingChallenge.beatmapId) {
            return interaction.editReply({
              embeds: await ctx.createEmbed('You have no score for this beatmap. Play it first!'),
              ephemeral: true
            });
          }
        }
      } else {
        const recentScoresData = await ctx.getUserRecentScores(osuUserId, { limit: 1, include_fails: false });
        const recentScores = Array.isArray(recentScoresData) ? recentScoresData : [];

        if (!recentScores || recentScores.length === 0) {
          return interaction.editReply({
            embeds: await ctx.createEmbed('You have no recent scores. Play a map first!'),
            ephemeral: true
          });
        }

        responderScore = recentScores[0];

        if (responderScore.beatmap?.id?.toString() !== existingChallenge.beatmapId) {
          return interaction.editReply({
            embeds: await ctx.createEmbed('Your most recent score is not for this beatmap. Use `/rsc` with the map link to respond to this challenge.'),
            ephemeral: true
          });
        }
      }
    }

    // When responding without a score link, use the user's best score on the beatmap for comparison
    // so we compare champion vs best rather than champion vs most recent (which can be worse).
    if (!respondForMapLink) {
      const bestOnMap = await ctx.getUserBeatmapScore(existingChallenge.beatmapId, osuUserId);
      if (bestOnMap && ctx.isValidScore(bestOnMap)) {
        responderScore = bestOnMap;
      }
    }

    const challengerScore = existingChallenge.challengerScore;
    const challengeDifficulty = existingChallenge.difficulty;

    if (typeof challengerScore !== 'object' || challengerScore === null) {
      return interaction.editReply({
        embeds: await ctx.createEmbed('Error: Challenge data is invalid. Please create a new challenge.'),
        ephemeral: true
      });
    }

    const mapTitle = await ctx.getMapTitle(challengerScore);
    const artist = await ctx.getMapArtist(challengerScore);
    const difficultyLabel = ctx.formatDifficultyLabel(mapTitle, challengeDifficulty, artist);
    const starRatingText = await ctx.formatStarRating(challengerScore);
    const beatmapLink = ctx.formatBeatmapLink(challengerScore);
    const difficultyLink = beatmapLink ? `${starRatingText}[${difficultyLabel}](${beatmapLink})` : `${starRatingText}**${difficultyLabel}**`;

    let comparisonResult;
    try {
      comparisonResult = ctx.compareScores(challengerScore, responderScore, interaction.user.username);
    } catch (error) {
      console.error('Error comparing scores:', error);
      return interaction.editReply({
        embeds: await ctx.createEmbed(`Error comparing scores: ${error.message}`),
        ephemeral: true
      });
    }

    const { responderWins, statWinners } = comparisonResult;
    const responderWon = responderWins >= 3;
    const isOwnChallenge = existingChallenge.challengerUserId === userId;

    if (responderWon) {
      try {
        await ctx.activeChallenges.updateChampion(
          guildId,
          existingChallenge.beatmapId,
          challengeDifficulty,
          userId,
          osuUserId,
          responderScore
        );
      } catch (error) {
        console.error('Error updating challenge champion:', error);
      }
    }

    const championOsuId = existingChallenge.challengerOsuId;
    let leftUser = { avatarBuffer: null, username: challengerScore.user?.username || 'Champion' };
    let rightUser = { avatarBuffer: null, username: interaction.user.username };
    try {
      const championUser = await ctx.getUser(championOsuId);
      if (championUser) {
        leftUser.username = (championUser.username && String(championUser.username).trim()) || leftUser.username;
        if (championUser.avatar_url) {
          const res = await fetch(championUser.avatar_url);
          if (res.ok) leftUser.avatarBuffer = Buffer.from(await res.arrayBuffer());
        }
      }
      const responderUser = await ctx.getUser(osuUserId);
      if (responderUser) {
        rightUser.username = (responderUser.username && String(responderUser.username).trim()) || interaction.user.username;
        if (responderUser.avatar_url) {
          const res = await fetch(responderUser.avatar_url);
          if (res.ok) rightUser.avatarBuffer = Buffer.from(await res.arrayBuffer());
        }
      }
    } catch (e) {
      console.warn('[rsc] Failed to fetch osu users for card:', e.message);
    }

    const loserSide = responderWon ? 'left' : 'right';
    const cardBuffer = await ctx.drawChallengeCard(leftUser, rightUser, challengerScore, responderScore, statWinners, loserSide);
    const cardAttachment = new ctx.AttachmentBuilder(cardBuffer, { name: 'challenge-card.png' });

    const statsLine = `(${responderWins}/5 key stats)`;
    const displayName = interaction.user.username;
    let statusMessage = '';
    if (isOwnChallenge) {
      if (responderWon) {
        statusMessage = `\n\n🏆 **${displayName} has improved the score! The stakes are higher now!** ${statsLine} 🏆`;
      } else {
        statusMessage = `\n\n😅 **${displayName} has failed to improve the score. Let's pretend Teto didn't see that...**`;
      }
    } else {
      if (responderWon) {
        statusMessage = `\n\n🏆 **${displayName} has won the challenge and is now the new champion!** ${statsLine} 🏆`;
      } else {
        statusMessage = `\n\n❌ **${displayName} did not win the challenge.** ${statsLine} The current champion remains.`;
      }
    }

    const messageBeforeImage = `<@${userId}> has responded to the challenge on ${difficultyLink}!\nLet's see who is better!`;
    const messageAfterImage = `\n\n${statusMessage}`;

    const embed1 = new ctx.EmbedBuilder()
      .setColor(ctx.BOT_EMBED_COLOR)
      .setDescription(messageBeforeImage)
      .setImage('attachment://challenge-card.png');
    const embed2 = new ctx.EmbedBuilder()
      .setColor(ctx.BOT_EMBED_COLOR)
      .setDescription(messageAfterImage);
    await opChannel.send({ embeds: [embed1, embed2], files: [cardAttachment] });

    return interaction.editReply({
      embeds: await ctx.createEmbed(`Challenge response posted to <#${opChannel.id}>!`),
      ephemeral: true
    });
  } catch (error) {
    console.error('Error in /rsc command:', error);
    return interaction.editReply({
      embeds: await ctx.createEmbed(`Error: ${error.message}`),
      ephemeral: true
    });
  }
}

export async function handleTc(interaction, ctx) {
  await interaction.deferReply({ ephemeral: false });

  try {
    const guildId = interaction.guildId;
    if (!guildId) {
      return interaction.editReply({
        embeds: await ctx.createEmbed('This command can only be used in a server.'),
        ephemeral: true
      });
    }
    const userId = interaction.user.id;
    const channel = interaction.channel;

    const association = await ctx.associations.get(guildId, userId);
    if (!association || !association.osuUserId) {
      return interaction.editReply({
        embeds: await ctx.createEmbed('You need to link your Discord profile to your OSU! profile first. Use `/teto link` command to do so.'),
        ephemeral: true
      });
    }

    const osuUserId = association.osuUserId;

    const messages = await channel.messages.fetch({ limit: 20 });

    let beatmapInfo = null;
    for (const [, message] of messages) {
      let messageText = message.content || '';

      if (message.embeds && message.embeds.length > 0) {
        for (const embed of message.embeds) {
          if (embed.description) messageText += ' ' + embed.description;
          if (embed.title) messageText += ' ' + embed.title;
          if (embed.footer?.text) messageText += ' ' + embed.footer.text;
          if (embed.author?.name) messageText += ' ' + embed.author.name;
          if (embed.url) messageText += ' ' + embed.url;
          if (embed.fields && Array.isArray(embed.fields)) {
            for (const field of embed.fields) {
              if (field.name) messageText += ' ' + field.name;
              if (field.value) messageText += ' ' + field.value;
            }
          }
        }
      }

      messageText = messageText.trim();

      beatmapInfo = ctx.extractBeatmapInfoFromMessage(messageText);
      if (beatmapInfo) break;

      const anyOsuLinkMatch = messageText.match(/https?:\/\/osu\.ppy\.sh\/[^\s\)]+/);
      if (anyOsuLinkMatch) {
        const resolved = await ctx.resolveMapOrScoreLink(anyOsuLinkMatch[0]);
        if (resolved?.beatmapId) {
          beatmapInfo = {
            beatmapId: resolved.beatmapId,
            difficulty: resolved.score?.beatmap?.version ?? null
          };
          break;
        }
      }
    }

    if (!beatmapInfo) {
      return interaction.editReply({
        embeds: await ctx.createEmbed('No difficulty or score link found in the last 20 messages of this channel. Use a map link (e.g. osu.ppy.sh/b/123) or a score link (e.g. osu.ppy.sh/scores/123).'),
        ephemeral: true
      });
    }

    let { beatmapId, difficulty } = beatmapInfo;
    let finalDifficulty = difficulty;
    let beatmapData = null;

    try {
      const allBeatmapScores = await ctx.getUserBeatmapScoresAll(beatmapId, osuUserId);
      let beatmapDifficulty = null;
      try {
        beatmapData = await ctx.getBeatmap(beatmapId);
        beatmapDifficulty = beatmapData.version;
        if (beatmapDifficulty) finalDifficulty = beatmapDifficulty;
      } catch (error) {
        // Continue without difficulty match
      }

      const matchingScores = allBeatmapScores;

      if (matchingScores.length > 0) {
        const sortedScores = matchingScores
          .sort((a, b) => (b.score || 0) - (a.score || 0))
          .slice(0, 8);

        let mapTitle = null;
        let beatmapLink = null;

        if (beatmapData) {
          mapTitle = beatmapData.beatmapset?.title || beatmapData.beatmapset?.title_unicode || 'Unknown Map';
          const beatmapsetId = beatmapData.beatmapset_id || beatmapData.beatmapset?.id;
          beatmapLink = ctx.buildBeatmapLinkFromIds(beatmapId, beatmapsetId);
        } else {
          const firstScore = sortedScores[0];
          beatmapLink = ctx.formatBeatmapLink(firstScore);
          mapTitle = await ctx.getMapTitle(firstScore);
        }

        const scoreOrBeatmapForStarRating = beatmapData || sortedScores[0];
        const artist = beatmapData?.beatmapset?.artist || beatmapData?.beatmapset?.artist_unicode || await ctx.getMapArtist(sortedScores[0]) || '';
        const displayDifficulty = beatmapDifficulty || sortedScores[0]?.beatmap?.version || difficulty || 'Unknown';
        const difficultyLabel = ctx.formatDifficultyLabel(mapTitle, displayDifficulty, artist);
        const starRatingText = await ctx.formatStarRating(scoreOrBeatmapForStarRating);
        const difficultyLink = beatmapLink ? `${starRatingText}[${difficultyLabel}](${beatmapLink})` : `${starRatingText}**${difficultyLabel}**`;

        let message = `Your scores on ${difficultyLink}:\n\n`;

        for (let i = 0; i < sortedScores.length; i++) {
          const score = sortedScores[i];
          if (i === 0) {
            let enhancedScore = score;
            if (beatmapData) {
              const csValue = beatmapData.cs ?? beatmapData.circle_size ?? null;
              const arValue = beatmapData.ar ?? beatmapData.approach_rate ?? null;
              const bpmValue = beatmapData.bpm ?? null;
              const odValue = beatmapData.accuracy ?? beatmapData.overall_difficulty ?? null;
              const hpValue = beatmapData.drain ?? beatmapData.hp ?? beatmapData.health ?? null;
              const finalCs = csValue ?? score.beatmap?.cs ?? score.beatmap?.circle_size ?? null;
              const finalAr = arValue ?? score.beatmap?.ar ?? score.beatmap?.approach_rate ?? null;
              const finalBpm = bpmValue ?? score.beatmap?.bpm ?? null;
              const finalOd = odValue ?? score.beatmap?.accuracy ?? score.beatmap?.overall_difficulty ?? null;
              const finalHp = hpValue ?? score.beatmap?.drain ?? score.beatmap?.hp ?? score.beatmap?.health ?? null;
              enhancedScore = {
                ...score,
                beatmap: {
                  ...(score.beatmap || {}),
                  id: score.beatmap?.id ?? beatmapData.id ?? beatmapId,
                  cs: finalCs,
                  ar: finalAr,
                  bpm: finalBpm,
                  accuracy: finalOd,
                  overall_difficulty: finalOd,
                  drain: finalHp,
                  hp: finalHp,
                  health: finalHp,
                  circle_size: finalCs,
                  approach_rate: finalAr,
                }
              };
            }
            const playerStats = await ctx.formatPlayerStats(enhancedScore);
            message += `**Score #${i + 1}**\n${playerStats}`;
          } else {
            const compactStats = await ctx.formatPlayerStatsCompact(score);
            message += `**Score #${i + 1}**: ${compactStats}\n`;
          }
        }

        const imageUrl = await ctx.getBeatmapsetImageUrl(beatmapData || sortedScores[0]);
        return interaction.editReply({
          embeds: await ctx.createEmbed(message, imageUrl)
        });
      }
    } catch (error) {
      console.error('Error fetching scores from osu! API:', error);
    }

    if (!beatmapData) {
      try {
        beatmapData = await ctx.getBeatmap(beatmapId);
        finalDifficulty = beatmapData.version;
      } catch (error) {
        // Continue
      }
    } else {
      finalDifficulty = beatmapData.version;
    }
    const localScoreRecords = await ctx.localScores.getByBeatmapAndDifficulty(guildId, userId, beatmapId, finalDifficulty);

    if (localScoreRecords && localScoreRecords.length > 0) {
      const sortedRecords = localScoreRecords
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 8);

      const firstScore = sortedRecords[0].score;
      let beatmapLink = ctx.formatBeatmapLink(firstScore);
      let mapTitle = await ctx.getMapTitle(firstScore);
      let localBeatmapData = null;

      if (!beatmapLink || mapTitle === 'Unknown Map') {
        const { beatmap: b, link } = await ctx.getBeatmapAndLink(beatmapId);
        localBeatmapData = b ?? localBeatmapData;
        if (b && (!mapTitle || mapTitle === 'Unknown Map')) {
          mapTitle = b.beatmapset?.title || b.beatmapset?.title_unicode || 'Unknown Map';
        }
        if (!beatmapLink && link) beatmapLink = link;
      }

      if (!localBeatmapData && finalDifficulty) {
        try {
          localBeatmapData = await ctx.getBeatmap(beatmapId);
        } catch (error) {
          // Continue
        }
      }
      const scoreOrBeatmapForStarRating = localBeatmapData || sortedRecords[0].score;
      const artist = localBeatmapData?.beatmapset?.artist || localBeatmapData?.beatmapset?.artist_unicode || await ctx.getMapArtist(sortedRecords[0].score) || '';
      const difficultyLabel = ctx.formatDifficultyLabel(mapTitle, finalDifficulty || sortedRecords[0].score.beatmap?.version || 'Unknown', artist);
      const starRatingText = await ctx.formatStarRating(scoreOrBeatmapForStarRating);
      const difficultyLink = beatmapLink ? `${starRatingText}[${difficultyLabel}](${beatmapLink})` : `${starRatingText}**${difficultyLabel}**`;

      const storageText = await ctx.formatTetoText('(from Teto memories):');
      let message = `Your scores on ${difficultyLink} ${storageText}\n\n`;

      for (let i = 0; i < sortedRecords.length; i++) {
        const record = sortedRecords[i];
        if (i === 0) {
          let enhancedScore = record.score;
          if (localBeatmapData && record.score.beatmap) {
            const csValue = localBeatmapData.cs ?? localBeatmapData.circle_size ?? record.score.beatmap.cs ?? record.score.beatmap.circle_size ?? null;
            const arValue = localBeatmapData.ar ?? localBeatmapData.approach_rate ?? record.score.beatmap.ar ?? record.score.beatmap.approach_rate ?? null;
            const bpmValue = localBeatmapData.bpm ?? record.score.beatmap.bpm ?? null;
            const odValue = localBeatmapData.accuracy ?? localBeatmapData.overall_difficulty ?? record.score.beatmap.accuracy ?? record.score.beatmap.overall_difficulty ?? null;
            const hpValue = localBeatmapData.drain ?? localBeatmapData.hp ?? localBeatmapData.health ?? record.score.beatmap.drain ?? record.score.beatmap.hp ?? record.score.beatmap.health ?? null;
            enhancedScore = {
              ...record.score,
              beatmap: {
                ...record.score.beatmap,
                cs: csValue,
                ar: arValue,
                bpm: bpmValue,
                accuracy: odValue,
                overall_difficulty: odValue,
                drain: hpValue,
                hp: hpValue,
                health: hpValue,
                circle_size: csValue,
                approach_rate: arValue,
              }
            };
          }
          const playerStats = await ctx.formatPlayerStats(enhancedScore);
          message += `**Score #${i + 1}**\n${playerStats}`;
        } else {
          const compactStats = await ctx.formatPlayerStatsCompact(record.score);
          message += `**Score #${i + 1}**: ${compactStats}\n`;
        }
      }

      const imageUrl = await ctx.getBeatmapsetImageUrl(localBeatmapData || firstScore);
      return interaction.editReply({
        embeds: await ctx.createEmbed(message, imageUrl)
      });
    }

    let mapTitle = null;
    let difficultyName = null;
    let beatmapLink = null;
    let beatmapDataForError = null;

    try {
      const { beatmap: b, link } = await ctx.getBeatmapAndLink(beatmapId);
      beatmapDataForError = b;
      if (beatmapDataForError) {
        mapTitle = beatmapDataForError.beatmapset?.title || beatmapDataForError.beatmapset?.title_unicode || 'Unknown Map';
        difficultyName = beatmapDataForError.version;
        beatmapLink = link;
      }
    } catch (error) {
      console.error('Error fetching beatmap data for error message:', error);
    }

    const artistForError = beatmapDataForError?.beatmapset?.artist || beatmapDataForError?.beatmapset?.artist_unicode || '';
    let difficultyLabel = null;
    if (mapTitle && difficultyName && beatmapLink) {
      const difficultyLabelText = ctx.formatDifficultyLabel(mapTitle, difficultyName, artistForError);
      const starRatingText = beatmapDataForError ? await ctx.formatStarRating(beatmapDataForError) : '';
      difficultyLabel = `${starRatingText}[${difficultyLabelText}](${beatmapLink})`;
    } else if (difficultyName && beatmapLink) {
      const difficultyLabelText = ctx.formatDifficultyLabel('Unknown Map', difficultyName, artistForError);
      const starRatingText = beatmapDataForError ? await ctx.formatStarRating(beatmapDataForError) : '';
      difficultyLabel = `${starRatingText}[${difficultyLabelText}](${beatmapLink})`;
    } else if (difficultyName) {
      difficultyLabel = `difficulty **${difficultyName}**`;
    } else {
      difficultyLabel = 'this difficulty';
    }

    return interaction.editReply({
      embeds: await ctx.createEmbed(`No score found for ${difficultyLabel}. Play it first!`),
      ephemeral: true
    });
  } catch (error) {
    console.error('Error in /tc command:', error);
    return interaction.editReply({
      embeds: await ctx.createEmbed(`Error: ${error.message}`),
      ephemeral: true
    });
  }
}
