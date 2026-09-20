import type {RULES} from '../domain';
export interface Wallet {userId:string;balance:number;version:number;ledgerSeq:number;rounds:number;wins:number;totalStake:number;totalPayout:number;lastPlayAt:number}
export interface User {userId:string;nickname:string;createdAt:number;profileVersion:number}
export interface Request {action:string;requestId:string;payload:Record<string,any>}
export type Response = {ok:true;data:any;traceId:string;serverTime:number} | {ok:false;error:{code:string;message:string;retryable:boolean};traceId:string;serverTime:number};
export interface Bootstrap {user:User;wallet:Wallet;rules:typeof RULES;rewards:{signed:boolean;streak:number;adCount:number;adEnabled:boolean;adMinSeconds:number;adUnitId:string};mode:'demo'|'cloud'}
