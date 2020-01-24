export interface MapEvent {
	readonly bucket: string;
	readonly jobRootFolder: string;
	readonly folder: string;
	readonly reviewIds: readonly string[];
}