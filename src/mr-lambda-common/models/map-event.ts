export interface MapEvent {
	readonly bucket: string;
	readonly jobRootFolder: string;
	readonly folder: string;
	readonly implementation: string;
	readonly reviewIds: readonly string[];
}
