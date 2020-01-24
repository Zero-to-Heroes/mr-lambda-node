export interface ReduceEvent {
	readonly bucket: string;
	readonly outputFolder: string;
	readonly jobRootFolder: string;
	readonly eventId: string;
	readonly fileKeys: readonly string[];
}