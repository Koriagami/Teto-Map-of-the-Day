import { SlashCommandBuilder } from 'discord.js';

const VALID_MODS = ["EZ","NF","HT","HR","SD","PF","DT","NC","HD","FL","RL","SO","SV2"];

const mapSubmit = new SlashCommandBuilder()
  .setName('teto')
  .setDescription('Teto bot commands')
  .addSubcommand(sub =>
    sub
      .setName('setup')
      .setDescription('Setup the bot in the current channel (admin only)')
      .addStringOption(opt =>
        opt
          .setName('set_this_channel_for')
          .setDescription('What this channel should be used for')
          .setRequired(true)
          .addChoices(
            { name: 'TMOTD', value: 'tmotd' },
            { name: 'Challenges', value: 'challenges' }
          )
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('link')
      .setDescription('Link your Discord account to your OSU! profile')
      .addStringOption(opt =>
        opt
          .setName('profilelink')
          .setDescription('Link to your OSU! profile')
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('test')
      .setDescription('Test command UI (admin only)')
      .addStringOption(opt =>
        opt
          .setName('command')
          .setDescription('Command to test')
          .setRequired(true)
          .addChoices(
            { name: 'trs', value: 'trs' },
            { name: 'tc', value: 'tc' },
            { name: 'rsci', value: 'rsci' },
            { name: 'rscr', value: 'rscr' },
            { name: 'motd', value: 'motd' },
            { name: 'report', value: 'report' },
            { name: 'card', value: 'card' }
          )
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('help')
      .setDescription('Show all available commands and their descriptions')
  )
  .addSubcommandGroup(group => {
    const g = group
      .setName('map')
      .setDescription('OSU map tools')
      .addSubcommand(sc => {
        const s = sc
          .setName('submit')
          .setDescription('Submit your map of the day')
          .addStringOption(opt =>
            opt
              .setName('maplink')
              .setDescription('Link to OSU! beatmap or score (e.g. osu.ppy.sh/b/123 or osu.ppy.sh/scores/123)')
              .setRequired(true)
          );
        for (let i = 1; i <= 5; i++) {
          s.addStringOption(opt =>
            opt
              .setName(`recommended_mod_${i}`)
              .setDescription('Optional recommended mod')
              .setRequired(false)
              .addChoices(...VALID_MODS.map(m => ({ name: m, value: m })))
          );
        }
        return s;
      });
    return g;
  });

const rscCommand = new SlashCommandBuilder()
  .setName('rsc')
  .setDescription('Issue or respond to a score challenge')
  .addStringOption(opt =>
    opt
      .setName('respond_for_map_link')
      .setDescription('Link to OSU! beatmap or score (e.g. osu.ppy.sh/b/123 or osu.ppy.sh/scores/123)')
      .setRequired(false)
  );

const trsCommand = new SlashCommandBuilder()
  .setName('trs')
  .setDescription('Record your unranked scores');

const tcCommand = new SlashCommandBuilder()
  .setName('tc')
  .setDescription('Look up your scores for the map');

export const commands = [mapSubmit.toJSON(), rscCommand.toJSON(), trsCommand.toJSON(), tcCommand.toJSON()];
