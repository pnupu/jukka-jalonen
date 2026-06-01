import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { BotState, FlexEvent, GuildConfig } from './types';

const STATE_PATH = process.env.STATE_PATH || './data/state.json';

const emptyState = (): BotState => ({
  guilds: {},
  events: {},
});

export class StateStore {
  private state: BotState = emptyState();
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      const raw = await readFile(STATE_PATH, 'utf8');
      this.state = JSON.parse(raw) as BotState;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        console.warn(`Failed to load ${STATE_PATH}, starting with empty state`, error);
      }
      this.state = emptyState();
    }

    this.loaded = true;
  }

  async save(): Promise<void> {
    await mkdir(dirname(STATE_PATH), { recursive: true });
    await writeFile(STATE_PATH, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
  }

  getGuildConfig(guildId: string): GuildConfig | undefined {
    return this.state.guilds[guildId];
  }

  async setGuildConfig(config: GuildConfig): Promise<void> {
    this.state.guilds[config.guildId] = config;
    await this.save();
  }

  getEvent(eventId: string): FlexEvent | undefined {
    return this.state.events[eventId];
  }

  async setEvent(event: FlexEvent): Promise<void> {
    this.state.events[event.id] = event;
    await this.save();
  }
}
