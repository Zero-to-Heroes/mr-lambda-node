import { SqsMessage } from './sqs-message';

export interface TriggerWatcherEvent extends SqsMessage {
	readonly bucket: string;
	readonly folder: string;
	readonly jobRootFolder: string;
	readonly expectedNumberOfFiles: number;
}
