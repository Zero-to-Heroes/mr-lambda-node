export interface TurnInfoForDb {
	readonly periodStart: string;
	readonly heroCardId: string;
	readonly turn: number;
	readonly dataPoints: number;
	readonly totalValue: number;
}
