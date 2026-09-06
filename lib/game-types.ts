export type Phase = 'lobby' | 'briefing' | 'ask' | 'priority' | 'finished';
export type Answer = 'YES' | 'NO' | 'UNKNOWN';
export type AskPrivacy = 'public' | 'private-question' | 'private-answer';
export type GameCategory = 'overwatch' | 'street-fighter-6' | 'pokemon-151';
export const CATEGORY_LABELS: Record<GameCategory, string> = {
  overwatch: '《守望先锋》角色',
  'street-fighter-6': '《街头霸王 6》角色',
  'pokemon-151': '宝可梦·初代 151',
};
export type Event = {
  id: string;
  player: number;
  kind: 'ask' | 'guess' | 'pass' | 'timeout' | 'notice';
  text: string;
  answer?: Answer;
  answerHidden?: boolean;
  privacy?: AskPrivacy;
  correct?: boolean;
};
export type AbilityState = {
  privateQuestion: boolean;
  privateAnswer: boolean;
};
export type Room = {
  code: string;
  revision: number;
  players: {
    id: string;
    name: string;
    avatar: string;
    wins: number;
    losses: number;
    lastResult: 'win' | 'loss' | null;
  }[];
  you: number;
  phase: Phase;
  turn: number;
  round: number;
  history: Event[];
  winner: number | null;
  answer?: string;
  busy: boolean;
  mode: 'ai' | 'demo';
  questions: string[];
  ready: number[];
  deadline: number | null;
  lives: [number, number];
  abilities: [AbilityState, AbilityState];
  winReason?: 'correct' | 'out-of-lives';
  category: GameCategory;
};
