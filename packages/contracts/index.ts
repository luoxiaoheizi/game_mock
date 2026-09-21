import type {RULES} from '../domain';
export interface Wallet {userId:string;balance:number;version:number;ledgerSeq:number;rounds:number;wins:number;profitWins?:number;totalStake:number;totalPayout:number;lastPlayAt:number}
export type RankingBoard = 'winRate'|'turnover';
export interface RankingRow {userId:string;nickname:string;isMe:boolean;rounds:number;profitWins:number;totalStake:number;winRate:number|null;rank:number|null}
export interface FriendRankings {boards:Record<RankingBoard,RankingRow[]>;asOf:number}
export interface User {userId:string;nickname:string;createdAt:number;profileVersion:number}
export interface Request {action:string;requestId:string;payload:Record<string,any>}
export type Response = {ok:true;data:any;traceId:string;serverTime:number} | {ok:false;error:{code:string;message:string;retryable:boolean};traceId:string;serverTime:number};
export interface SignInPreview {day:number;amount:number;claimed:boolean}
export interface Rewards {signed:boolean;streak:number;dailyDay:number;dailyAmount:number;nextDailyAmount:number;dailyPreview:SignInPreview[];adCount:number;adNextAmount:number;adEnabled:boolean;adMinSeconds:number;adUnitId:string}
export interface Bootstrap {user:User;wallet:Wallet;rules:typeof RULES;rewards:Rewards;mode:'demo'|'cloud'}
