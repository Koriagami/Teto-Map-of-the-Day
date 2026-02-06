/**
 * Slash command handlers for /rsc, /tc, /trs, and /teto.
 * Each handler receives (interaction, ctx) where ctx provides all dependencies.
 */

import { PermissionsBitField } from 'discord.js';
import { runTestCommand } from './testHandlers.js';

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

    let responderScore;

    if (respondForMapLink) {
      // With link: best score = highest flat score value only. The single-score API endpoint does NOT
      // return best by score value; use /all and pick max by extractScoreValue. Then use local if better.
      let apiScores = [];
      try {
        apiScores = (await ctx.getUserBeatmapScoresAll(existingChallenge.beatmapId, osuUserId)) || [];
      } catch (e) {
        console.warn('getUserBeatmapScoresAll failed:', e?.message);
      }
      if (apiScores.length > 0) {
        const validStrict = apiScores.filter((s) => s && ctx.isValidScore(s));
        const valid =
          validStrict.length > 0
            ? validStrict
            : apiScores.filter((s) => s && typeof ctx.extractScoreValue(s) === 'number');
        if (valid.length > 0) {
          responderScore = valid.reduce((best, s) => {
            const v = Number(ctx.extractScoreValue(s)) || 0;
            const bestV = Number(ctx.extractScoreValue(best)) || 0;
            return v > bestV ? s : best;
          });
        }
      }
      const hasValidValue = responderScore && Number(ctx.extractScoreValue(responderScore)) > 0;
      if (!hasValidValue) {
        return interaction.editReply({
          embeds: await ctx.createEmbed('You have no score for this beatmap. Play it first!'),
          ephemeral: true
        });
      }
      // Enrich responder score with beatmap from challenge if API omitted it (e.g. /all response)
      if (responderScore && (!responderScore.beatmap?.version || !responderScore.beatmap?.id)) {
        if (existingChallenge.challengerScore?.beatmap) {
          responderScore.beatmap = { ...existingChallenge.challengerScore.beatmap, ...responderScore.beatmap };
        } else {
          try {
            const b = await ctx.getBeatmap(existingChallenge.beatmapId);
            if (b) responderScore.beatmap = { ...b, ...responderScore.beatmap };
          } catch (_) {}
        }
      }
      const apiScoreValue = Number(ctx.extractScoreValue(responderScore)) || 0;
      try {
        const localRecords = await ctx.localScores.getByBeatmapAndDifficulty(
          guildId, userId, existingChallenge.beatmapId, existingChallenge.difficulty
        );
        let bestLocalScore = null;
        let bestLocalValue = apiScoreValue;
        for (const record of localRecords || []) {
          const s = record?.score;
          if (s && ctx.isValidScore(s)) {
            const localValue = Number(ctx.extractScoreValue(s)) || 0;
            if (localValue > bestLocalValue) {
              bestLocalValue = localValue;
              bestLocalScore = s;
            }
          }
        }
        if (bestLocalScore) responderScore = bestLocalScore;
      } catch (e) {
        console.error('Error checking local scores for respond-with-link:', e);
      }
    } else {
      // Without link: compare challenge to the user's most recent score (must be for this beatmap)
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
    let responderWon = responderWins >= 3;
    const isOwnChallenge = existingChallenge.challengerUserId === userId;
    // Own-challenge fallback: if new score has strictly higher full raw score, count as improvement even when metric wins < 3
    if (isOwnChallenge && !responderWon) {
      const championScoreValue = Number(ctx.extractScoreValue(existingChallenge.challengerScore)) || 0;
      const newScoreValue = Number(ctx.extractScoreValue(responderScore)) || 0;
      if (newScoreValue > championScoreValue) responderWon = true;
    }

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
        statusMessage = `\n\n🏆 **${displayName} has improved the score! The stakes are higher now!** ${statsLine}`;
      } else {
        statusMessage = `\n\n😅 **${displayName} has failed to improve the score. Let's pretend Teto didn't see that...**`;
      }
    } else {
      if (responderWon) {
        statusMessage = `\n\n🏆 **${displayName} has won the challenge and is now the new champion!** ${statsLine}`;
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

export async function handleTrs(interaction, ctx) {
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

    const association = await ctx.associations.get(guildId, userId);
    if (!association || !association.osuUserId) {
      return interaction.editReply({
        embeds: await ctx.createEmbed('You need to link your Discord profile to your OSU! profile first. Use `/teto link` command to do so.'),
        ephemeral: true
      });
    }

    const osuUserId = association.osuUserId;

    const recentScoresData = await ctx.getUserRecentScores(osuUserId, { limit: 1, include_fails: true });
    const recentScores = Array.isArray(recentScoresData) ? recentScoresData : [];

    if (!recentScores || recentScores.length === 0) {
      return interaction.editReply({
        embeds: await ctx.createEmbed('You have no recent scores. Play a map first!'),
        ephemeral: true
      });
    }

    const userScore = recentScores[0];

    if (!ctx.isValidScore(userScore)) {
      return interaction.editReply({
        embeds: await ctx.createEmbed('Invalid score data received from OSU API. Please play a map first and try again.'),
        ephemeral: true
      });
    }

    const beatmapId = userScore.beatmap.id.toString();
    let beatmapStatus = null;
    let beatmapStatusName = 'Unknown';

    if (userScore.beatmap?.status !== undefined) {
      beatmapStatus = userScore.beatmap.status;
      beatmapStatusName = ctx.getBeatmapStatusName(beatmapStatus);
    } else if (userScore.beatmap?.beatmapset?.status !== undefined) {
      beatmapStatus = userScore.beatmap.beatmapset.status;
      beatmapStatusName = ctx.getBeatmapStatusName(beatmapStatus);
    } else {
      try {
        const beatmap = await ctx.getBeatmap(beatmapId);
        beatmapStatus = beatmap?.status ?? beatmap?.beatmapset?.status;
        beatmapStatusName = ctx.getBeatmapStatusName(beatmapStatus);
      } catch (error) {
        // Continue with unknown status
      }
    }

    const beatmapLink = ctx.formatBeatmapLink(userScore);
    const playerStats = await ctx.formatPlayerStats(userScore);
    const mapTitle = await ctx.getMapTitle(userScore);
    const artist = await ctx.getMapArtist(userScore);
    const difficulty = userScore.beatmap.version;
    const difficultyLabel = ctx.formatDifficultyLabel(mapTitle, difficulty, artist);
    const starRatingText = await ctx.formatStarRating(userScore);
    const difficultyLink = beatmapLink ? `${starRatingText}[${difficultyLabel}](${beatmapLink})` : `${starRatingText}**${difficultyLabel}**`;

    const scoreRank = userScore.rank || 'N/A';
    const isRankF = scoreRank === 'F' || scoreRank === 'f';

    const isSaved = ctx.isScoreSavedOnOsu(beatmapStatus);
    let statusMessage = '';

    if (isSaved && !isRankF) {
      statusMessage = `\nThis map is **${beatmapStatusName}**. The score is saved on the OSU! servers.`;
    } else {
      try {
        const existing = await ctx.localScores.exists(guildId, userId, userScore);
        if (existing) {
          statusMessage = `\nThe map is **${beatmapStatusName}**. This score is already saved.`;
        } else {
          await ctx.localScores.create(guildId, userId, osuUserId, userScore);
          statusMessage = `\nThe map is **${beatmapStatusName}**. ${await ctx.formatTetoText('Teto will remember this score.')}`;
        }
      } catch (error) {
        console.error('Error saving local score:', error);
        statusMessage = `\nThe map is **${beatmapStatusName}**. Failed to save score locally.`;
      }
    }

    const message = `Your most recent score on ${difficultyLink}:\n\n${playerStats}${statusMessage}`;
    const imageUrl = await ctx.getBeatmapsetImageUrl(userScore);

    return interaction.editReply({
      embeds: await ctx.createEmbed(message, imageUrl)
    });
  } catch (error) {
    console.error('Error in /trs command:', error);
    return interaction.editReply({
      embeds: await ctx.createEmbed(`Error: ${error.message}`),
      ephemeral: true
    });
  }
}

export async function handleTeto(interaction, ctx) {
  const subcommandGroup = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand(false);
  const guildId = interaction.guildId;
  if (!guildId) {
    return interaction.reply({
      embeds: await ctx.createEmbed('This command can only be used in a server.'),
      ephemeral: true
    });
  }
  const channel = interaction.channel;

  if (sub === 'setup') {
    const member = interaction.member;
    if (!member) {
      return interaction.reply({ embeds: await ctx.createEmbed('Unable to verify permissions. Please try again.'), ephemeral: true });
    }
    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const memberPerms = member.permissions;
    const hasAdmin = memberPerms && memberPerms.has(PermissionsBitField.Flags.Administrator);
    if (!isOwner && !hasAdmin) {
      return interaction.reply({ embeds: await ctx.createEmbed('Only administrators can run this command.'), ephemeral: true });
    }
    const channelType = interaction.options.getString('set_this_channel_for');
    if (!channelType || (channelType !== 'tmotd' && channelType !== 'challenges')) {
      return interaction.reply({
        embeds: await ctx.createEmbed('Invalid channel type. Please select either "TMOTD" or "Challenges".'),
        ephemeral: true
      });
    }
    await ctx.dbServerConfig.setChannel(guildId, channelType, channel.id);
    const channelTypeName = channelType === 'tmotd' ? 'TMOTD' : 'Challenges';
    const message = await ctx.formatTetoText(`Teto configured! ${channelTypeName} channel set to <#${channel.id}>.`);
    return interaction.reply({
      embeds: await ctx.createEmbed(message),
      ephemeral: true
    });
  }

  if (sub === 'link') {
    const profileLink = interaction.options.getString('profilelink');
    if (!profileLink || !profileLink.includes('osu.ppy.sh/users/')) {
      return interaction.reply({
        embeds: await ctx.createEmbed('Invalid OSU! profile link. The link must contain "osu.ppy.sh/users/" in it.\nExample: https://osu.ppy.sh/users/12345 or https://osu.ppy.sh/users/username'),
        ephemeral: true
      });
    }
    const profileInfo = ctx.extractOsuProfile(profileLink);
    if (!profileInfo) {
      return interaction.reply({
        embeds: await ctx.createEmbed('Invalid OSU! profile link format. Please provide a valid link like:\n- https://osu.ppy.sh/users/12345\n- https://osu.ppy.sh/users/username'),
        ephemeral: true
      });
    }
    const existingAssociation = await ctx.associations.get(guildId, interaction.user.id);
    if (existingAssociation) {
      const existingDisplayName = existingAssociation.osuUsername || `User ${existingAssociation.osuUserId}`;
      return interaction.reply({
        embeds: await ctx.createEmbed(`You already have an OSU! profile linked: **${existingDisplayName}**\nProfile: ${existingAssociation.profileLink}\n\nTo link a different profile, please contact an administrator.`),
        ephemeral: true
      });
    }
    let existingOsuLink = null;
    if (profileInfo.userId) {
      existingOsuLink = await ctx.associations.findByOsuUserIdInGuild(guildId, profileInfo.userId);
    } else if (profileInfo.username) {
      existingOsuLink = await ctx.associations.findByOsuUsernameInGuild(guildId, profileInfo.username);
    }
    if (existingOsuLink && existingOsuLink.discordUserId !== interaction.user.id) {
      return interaction.reply({
        embeds: await ctx.createEmbed(`This OSU! profile is already linked to another Discord user (<@${existingOsuLink.discordUserId}>).\nEach OSU! profile can only be linked to one Discord account per server.`),
        ephemeral: true
      });
    }
    await interaction.deferReply({ ephemeral: true });
    try {
      const userIdentifier = profileInfo.userId || profileInfo.username;
      const osuUser = await ctx.getUser(userIdentifier);
      if (!osuUser) {
        return interaction.editReply({
          embeds: await ctx.createEmbed('The OSU! profile you provided does not exist.\nPlease check the link and try again.')
        });
      }
      const verifiedUserId = osuUser.id?.toString();
      const verifiedUsername = osuUser.username;
      const verifiedProfileLink = `https://osu.ppy.sh/users/${verifiedUserId}`;
      await ctx.associations.set(guildId, interaction.user.id, {
        discordUsername: interaction.user.username,
        osuUsername: verifiedUsername,
        osuUserId: verifiedUserId,
        profileLink: verifiedProfileLink,
      });
      return interaction.editReply({
        embeds: await ctx.createEmbed(`✅ Successfully linked your Discord account to OSU! profile: **${verifiedUsername}**\nProfile: ${verifiedProfileLink}`)
      });
    } catch (error) {
      console.error('Error verifying OSU profile:', error);
      return interaction.editReply({
        embeds: await ctx.createEmbed(`Error verifying OSU! profile: ${error.message}\nPlease try again later.`)
      });
    }
  }

  if (sub === 'help') {
    const helpMessage = `**Teto Bot Commands**

**Map of the Day:**
• \`/teto map submit\` — Submit your map of the day (optional mods)

**Challenges (\`/rsc\`):**
• No link: Use most recent score to issue or respond
• With link: Use your best score for that beatmap to issue or respond
• **Win rule:** 5 key stats (PP or 300s when both PP are 0, Accuracy, Max Combo, Score, Misses). Need **3+** to win. Response shows a comparison card and your stat count (X/5).
• Responding to your own challenge: better score → challenge updated; worse → "pretend Teto didn't see that"

**Score Tracking:**
• \`/trs\` — Record your most recent unranked/WIP score
• \`/tc\` — Look up your scores for a map (uses last 20 messages for link)

**Setup:**
• \`/teto setup\` — Set channel for TMOTD or Challenges (admin)
• \`/teto link\` — Link Discord to OSU! profile (required for most commands)
• \`/teto test\` — Test command UI (admin)
• \`/teto help\` — This message`;
    return interaction.reply({
      embeds: await ctx.createEmbed(helpMessage),
      ephemeral: true
    });
  }

  if (sub === 'test') {
    const member = interaction.member;
    if (!member) {
      return interaction.reply({ embeds: await ctx.createEmbed('Unable to verify permissions. Please try again.'), ephemeral: true });
    }
    const isOwner = interaction.guild.ownerId === interaction.user.id;
    const hasAdmin = member.permissions && member.permissions.has(PermissionsBitField.Flags.Administrator);
    if (!isOwner && !hasAdmin) {
      return interaction.reply({ embeds: await ctx.createEmbed('Only administrators can run this command.'), ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: false });
    try {
      const testCommand = interaction.options.getString('command');
      if (!testCommand) {
        return interaction.editReply({
          embeds: await ctx.createEmbed('Invalid test command. Available: trs, tc, rsci, rscr, motd, report, card'),
          ephemeral: true
        });
      }
      const handled = await runTestCommand(interaction, guildId, testCommand, ctx.buildTestContext());
      if (!handled) {
        return interaction.editReply({
          embeds: await ctx.createEmbed('Invalid test command. Available: trs, tc, rsci, rscr, motd, report, card'),
          ephemeral: true
        });
      }
    } catch (error) {
      console.error('Error in /teto test command:', error);
      return interaction.editReply({
        embeds: await ctx.createEmbed(`Error: ${error.message}`),
        ephemeral: true
      });
    }
    return;
  }

  if (subcommandGroup === 'map' && sub === 'submit') {
    const mapLink = interaction.options.getString('maplink');
    if (!mapLink || !mapLink.includes('osu.ppy.sh')) {
      return interaction.reply({ embeds: await ctx.createEmbed("Impossible to submit the map - link doesn't contain OSU! map"), ephemeral: true });
    }
    const resolved = await ctx.resolveMapOrScoreLink(mapLink);
    const effectiveBeatmapId = resolved?.beatmapId ?? ctx.extractBeatmapId(mapLink);
    if (!effectiveBeatmapId) {
      return interaction.reply({ embeds: await ctx.createEmbed("Could not extract beatmap or score from the link. Use a difficulty link (e.g. osu.ppy.sh/b/123) or a score link (e.g. osu.ppy.sh/scores/123)."), ephemeral: true });
    }
    const today = ctx.todayString();
    const hasSubmitted = await ctx.submissions.hasSubmittedToday(guildId, interaction.user.id, today);
    if (hasSubmitted) {
      return interaction.reply({ embeds: await ctx.createEmbed('You already submitted a map today!'), ephemeral: true });
    }
    const mods = [];
    for (let i = 1; i <= 5; i++) {
      const mod = interaction.options.getString(`recommended_mod_${i}`);
      if (mod) mods.push(mod);
    }
    const opChannelResult = await ctx.getOperatingChannel(guildId, interaction.guild, 'tmotd');
    if (opChannelResult.error) {
      return interaction.reply({ embeds: await ctx.createEmbed(opChannelResult.error), ephemeral: true });
    }
    const opChannel = opChannelResult.channel;
    const opChannelId = opChannelResult.channelId;

    let mapName = null;
    let difficultyName = null;
    let difficultyLink = mapLink;
    let imageUrl = null;
    let beatmap = null;

    try {
      if (effectiveBeatmapId) {
        const { beatmap: b, link } = await ctx.getBeatmapAndLink(effectiveBeatmapId);
        beatmap = b;
        if (beatmap) {
          mapName = beatmap?.beatmapset?.title || beatmap?.beatmapset?.title_unicode || null;
          difficultyName = beatmap?.version || null;
          imageUrl = await ctx.getBeatmapsetImageUrl(beatmap);
          if (link) difficultyLink = link;
        }
      }
    } catch (error) {
      console.error('Error getting beatmap data for map of the day:', error);
    }

    const artist = beatmap?.beatmapset?.artist || beatmap?.beatmapset?.artist_unicode || '';
    let difficultyLabel = null;
    const starRatingText = await ctx.formatStarRating(beatmap);
    if (mapName && difficultyName) {
      const label = ctx.formatDifficultyLabel(mapName, difficultyName, artist);
      difficultyLabel = `${starRatingText}[${label}](${difficultyLink})`;
    } else if (difficultyName) {
      const label = ctx.formatDifficultyLabel('Unknown Map', difficultyName, artist);
      difficultyLabel = `${starRatingText}[${label}](${difficultyLink})`;
    } else {
      difficultyLabel = starRatingText + difficultyLink;
    }

    let msgContent = `<@${interaction.user.id}> map of the day is - ${difficultyLabel}`;
    if (mods.length > 0) {
      msgContent += `\nRecommended mods: ${mods.join(', ')}`;
    }

    try {
      const sent = await opChannel.send({ embeds: await ctx.createEmbed(msgContent, imageUrl) });
      try {
        await sent.react('👍');
        await sent.react('👎');
      } catch (reactErr) {
        console.warn('Failed to add reactions to submission (non-critical):', reactErr);
      }
      await ctx.submissions.create(guildId, interaction.user.id, today);
      return interaction.reply({ embeds: await ctx.createEmbed(`Map submitted to <#${opChannelId}>!`), ephemeral: true });
    } catch (err) {
      console.error('Failed to post submission:', err);
      return interaction.reply({ embeds: await ctx.createEmbed('Failed to submit the map. Check bot permissions in the operating channel.'), ephemeral: true });
    }
  }
}
