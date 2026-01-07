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
      .setName('get_c_report')
      .setDescription('Generate and post the weekly challenges report (admin only)')
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
              .setDescription('Link to OSU map')
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
      .setDescription('Link to OSU! beatmap to respond to challenge (must contain osu.ppy.sh)')
      .setRequired(false)
  );

const trsCommand = new SlashCommandBuilder()
  .setName('trs')
  .setDescription('Track your most recent osu! score');

export const commands = [mapSubmit.toJSON(), rscCommand.toJSON(), trsCommand.toJSON()];
