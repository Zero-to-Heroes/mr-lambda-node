export interface DbLogEntity {
	readonly id: number;
	readonly jobName: string;
	readonly step: string;
	readonly fileKey: string;
	readonly reviewId: string;
	readonly status: string;
}