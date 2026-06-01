export type FlexResponseStatus = 'yes' | 'no' | 'other';

export interface FlexResponse {
  userId: string;
  displayName: string;
  status: FlexResponseStatus;
  otherTime?: string;
  updatedAt: string;
}

export interface FlexEvent {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string;
  creatorId: string;
  question: string;
  startsAt: string;
  durationMinutes: number;
  calendarEventId?: string;
  responses: Record<string, FlexResponse>;
  createdAt: string;
}

export interface GuildConfig {
  guildId: string;
  flexRoleId?: string;
  updatedAt: string;
}

export interface BotState {
  guilds: Record<string, GuildConfig>;
  events: Record<string, FlexEvent>;
}
