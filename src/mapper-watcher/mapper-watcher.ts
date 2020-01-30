/* eslint-disable @typescript-eslint/no-use-before-define */
import uuid from 'uuid/v4';
import { ReduceEvent } from '../mr-lambda-common/models/reduce-event';
import { TriggerWatcherEvent } from '../mr-lambda-common/models/trigger-watcher-event';
import { Db } from '../mr-lambda-common/services/db';
import { Sqs } from '../mr-lambda-common/services/sqs';
import { partitionArray, sleep } from '../mr-lambda-common/services/utils';

// We assume the global timeout for the function will be 600 seconds
const TIMEOUT_LIMIT = 1000 * 500;
// It the phase takes too long, cancel it for now
const MAX_ALLOWED_EXECUTION_TIME = 1000 * 60 * 60 * 2;
const REDUCER_FOLDER = 'reducer';
// Totally arbitrary, could be anything
const MAPPING_PER_REDUCER = 50;
const MAX_REDUCERS = 75;
const MAX_MAPPINGS_PER_REDUCER = 1000;

const sqs = new Sqs();
const db = new Db();

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event): Promise<any> => {
	// console.log('event', event);
	const start = Date.now();
	const triggerEvent: TriggerWatcherEvent = event.Records.map(event => JSON.parse(event.body))[0];
	const numberOfMappers = triggerEvent.expectedNumberOfFiles;
	// console.log('triggerEvent', triggerEvent, numberOfMappers);
	let numberOfFiles = 0;
	let previousCompletion = 0;
	while ((numberOfFiles = await countOutputFiles(triggerEvent)) < numberOfMappers) {
		console.log('mapping completion progress', numberOfFiles + '/' + numberOfMappers, previousCompletion);
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
			console.log('approaching time out, restarting function');
			await sqs.sendMessageToQueue(triggerEvent, process.env.SQS_MAPPER_WATCHER_URL);
			return;
		}
	}
	console.log('mapping phase over, starting reducer');
	const reduceEvents: readonly ReduceEvent[] = await startReducerPhase(
		await outputFileKeys(triggerEvent),
		triggerEvent.jobRootFolder,
	);
	console.log('reducing phase trigger done');
	const newTriggerEvent: TriggerWatcherEvent = {
		bucket: process.env.S3_BUCKET,
		folder: REDUCER_FOLDER,
		jobRootFolder: triggerEvent.jobRootFolder,
		expectedNumberOfFiles: reduceEvents.length,
	};
	console.log("Job's done! Passing the baton ", newTriggerEvent);
	await sqs.sendMessageToQueue(newTriggerEvent, process.env.SQS_REDUCER_WATCHER_URL);
	console.log('sent message to start reducers');
	return { statusCode: 200, body: '' };
};

const startReducerPhase = async (
	mapperOutputFileKeys: readonly string[],
	jobRootFolder: string,
): Promise<readonly ReduceEvent[]> => {
	const reviewsPerReducer = Math.min(
		MAX_MAPPINGS_PER_REDUCER,
		Math.ceil(Math.max(MAPPING_PER_REDUCER, mapperOutputFileKeys.length / MAX_REDUCERS)),
	);
	const fileKeysPerMapper: readonly string[][] = partitionArray(mapperOutputFileKeys, reviewsPerReducer);
	console.log(
		'grouping file keys per mapper',
		mapperOutputFileKeys.length,
		fileKeysPerMapper.length,
		fileKeysPerMapper[0].length,
	);
	const reduceEvents: readonly ReduceEvent[] = fileKeysPerMapper.map(files => buildReduceEvent(files, jobRootFolder));
	console.log('Built SQS reducer events to send: ' + reduceEvents.length);
	// console.log('First event: ' + reduceEvents[0]);
	await sqs.sendMessagesToQueue(reduceEvents, process.env.SQS_REDUCER_URL);
	console.log('Sent all SQS messages to reducers');
	return reduceEvents;
};

const buildReduceEvent = (mapperOutputFileKeys: readonly string[], jobBucketName: string): ReduceEvent => {
	return {
		bucket: process.env.S3_BUCKET,
		outputFolder: REDUCER_FOLDER,
		jobRootFolder: jobBucketName,
		fileKeys: mapperOutputFileKeys,
		eventId: uuid(),
	};
};

const countOutputFiles = async (event: TriggerWatcherEvent): Promise<number> => {
	return await db.countFilesCompleted(event.jobRootFolder, event.folder);
};

const outputFileKeys = async (event: TriggerWatcherEvent): Promise<readonly string[]> => {
	console.log('Getting output file keys for ' + event.jobRootFolder + ' and ' + event.folder);
	return await db.getFilesKeys(event.jobRootFolder, event.folder);
};
