/* eslint-disable @typescript-eslint/no-use-before-define */
import uuid from 'uuid/v4';
import { ReduceEvent } from '../mr-lambda-common/models/reduce-event';
import { TriggerWatcherEvent } from '../mr-lambda-common/models/trigger-watcher-event';
import { Db } from '../mr-lambda-common/services/db';
import { Sqs } from '../mr-lambda-common/services/sqs';
import { sleep } from '../mr-lambda-common/services/utils';

// We assume the global timeout for the function will be 600 seconds
const TIMEOUT_LIMIT = 1000 * 500;
// It the phase takes too long, cancel it for now
const MAX_ALLOWED_EXECUTION_TIME = 1000 * 60 * 60 * 2;
const RESULT_FOLDER = 'result';

const sqs = new Sqs();
const db = new Db();

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event): Promise<any> => {
	// console.log('event', event);
	const start = Date.now();
	const triggerEvent: TriggerWatcherEvent = event.Records.map(event => JSON.parse(event.body))[0];
	const numberOfReducers = triggerEvent.expectedNumberOfFiles;
	let numberOfFiles = 0;
	let previousCompletion = 0;
	while ((numberOfFiles = await countOutputFiles(triggerEvent)) < numberOfReducers) {
		console.log('Reducing completion progress', numberOfFiles + '/' + numberOfReducers);
		await sleep(2000);
		if (previousCompletion === -1) {
			console.warn('Things are stuck, moving forward', numberOfFiles);
			// We go on. Usually we don't really mind if things are stuck, it just reduces the sample size
			break;
		}
		if (previousCompletion === numberOfFiles) {
			// No update in the last step, usually that's a sign things are stuck
			console.warn('No update since last tick', numberOfFiles);
			previousCompletion = -1;
		} else {
			previousCompletion = numberOfFiles;
		}

		// We start a new process before this one times out, and the new process will resume
		// where we left, since if will always use the number of files as stored in db
		if (Date.now() - start > TIMEOUT_LIMIT && Date.now() - start < MAX_ALLOWED_EXECUTION_TIME) {
			console.log('Sending new message to queue to continue the process');
			await sqs.sendMessageToQueue(triggerEvent, process.env.SQS_REDUCER_WATCHER_URL);
			return;
		}
	}
	console.log('Reducing phase over, starting aggregation phase');
	await startAggregationPhase(await outputFileKeys(triggerEvent), triggerEvent.jobRootFolder);
	console.log('aggregation phase trigger done');
	const newTriggerEvent: TriggerWatcherEvent = {
		bucket: process.env.S3_BUCKET,
		folder: RESULT_FOLDER,
		jobRootFolder: triggerEvent.jobRootFolder,
		expectedNumberOfFiles: 1,
	};
	await sqs.sendMessageToQueue(newTriggerEvent, process.env.SQS_AGGREGATOR_WATCHER_URL);
	console.log("Job's done! Passing the baton ", newTriggerEvent);
	return { statusCode: 200, body: '' };
};

const startAggregationPhase = async (
	outputFileKeys: readonly string[],
	jobRootFolder: string,
): Promise<ReduceEvent> => {
	const aggregationEvent = {
		bucket: process.env.S3_BUCKET,
		outputFolder: RESULT_FOLDER,
		jobRootFolder: jobRootFolder,
		fileKeys: outputFileKeys,
		eventId: uuid(),
	} as ReduceEvent;
	console.log('Built SQS aggregation event to send');
	await sqs.sendMessageToQueue(aggregationEvent, process.env.SQS_AGGREGATOR_TRIGGER_URL);
	console.log('Sent all SQS messages to reducers');
	return aggregationEvent;
};

const countOutputFiles = async (event: TriggerWatcherEvent): Promise<number> => {
	return await db.countFilesCompleted(event.jobRootFolder, event.folder);
};

const outputFileKeys = async (event: TriggerWatcherEvent): Promise<readonly string[]> => {
	// console.log('Getting output file keys for ' + event.jobRootFolder + ' and ' + event.folder);
	return await db.getFilesKeys(event.jobRootFolder, event.folder);
};
