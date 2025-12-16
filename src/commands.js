import { SlashCommandBuilder } from 'discord.js';

const VALID_MODS = ["EZ","NF","HT","HR","SD","PF","DT","NC","HD","FL","RL","SO","SV2"];

const mapSubmit = new SlashCommandBuilder()
  .setName('teto')
  .setDescription('Teto bot commands')
  .addSubcommand(sub =>
    sub
      .setName('setup')
      .setDescription('Setup the bot in the current channel (admin only)')
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

const testCommand = new SlashCommandBuilder()
  .setName('test')
  .setDescription('Test OSU! API - Get leaderboard scores for a beatmap')
  .addStringOption(opt =>
    opt
      .setName('maplink')
      .setDescription('OSU! beatmap link or beatmap ID')
      .setRequired(true)
  )
  .addIntegerOption(opt =>
    opt
      .setName('limit')
      .setDescription('Number of scores to retrieve (default: 10, max: 100)')
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(100)
  );

export const commands = [mapSubmit.toJSON(), testCommand.toJSON()];
