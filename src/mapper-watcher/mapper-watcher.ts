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
const MAX_MAPPINGS_PER_REDUCER = 300;

const sqs = new Sqs();
const db = new Db();

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event): Promise<any> => {
	const start = Date.now();
	const triggerEvent: TriggerWatcherEvent = event.Records.map(event => JSON.parse(event.body))[0];
	const numberOfMappers = triggerEvent.expectedNumberOfFiles;
	let numberOfFiles = 0;
	let previousCompletion = 0;
	let retriesLeft = 50;
	while ((numberOfFiles = await countOutputFiles(triggerEvent)) < numberOfMappers) {
		await sleep(2000);
		if (retriesLeft < 0) {
			console.warn('Things are stuck, moving forward', numberOfFiles);
			// We go on. Usually we don't really mind if things are stuck, it just reduces the sample size
			break;
		}
		if (previousCompletion === numberOfFiles) {
			// No update in the last step, usually that's a sign things are stuck
			console.warn('No update since last tick', numberOfFiles);
			retriesLeft--;
		} else {
			previousCompletion = numberOfFiles;
			retriesLeft = 50;
		}

		// We start a new process before this one times out, and the new process will resume
		// where we left, since if will always use the number of files as stored in db
		if (Date.now() - start > TIMEOUT_LIMIT && Date.now() - start < MAX_ALLOWED_EXECUTION_TIME) {
			await sqs.sendMessageToQueue(triggerEvent, process.env.SQS_MAPPER_WATCHER_URL);
			return;
		}
	}
	const reduceEvents: readonly ReduceEvent[] = await startReducerPhase(
		await outputFileKeys(triggerEvent),
		triggerEvent.jobRootFolder,
		triggerEvent.implementation,
	);
	const newTriggerEvent: TriggerWatcherEvent = {
		bucket: process.env.S3_BUCKET,
		folder: REDUCER_FOLDER,
		jobRootFolder: triggerEvent.jobRootFolder,
		expectedNumberOfFiles: reduceEvents.length,
		implementation: triggerEvent.implementation,
	};
	await sqs.sendMessageToQueue(newTriggerEvent, process.env.SQS_REDUCER_WATCHER_URL);
	return { statusCode: 200, body: '' };
};

const startReducerPhase = async (
	mapperOutputFileKeys: readonly string[],
	jobRootFolder: string,
	implementation: string,
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
		fileKeysPerMapper[0]?.length,
	);
	const reduceEvents: readonly ReduceEvent[] = fileKeysPerMapper.map(files =>
		buildReduceEvent(files, jobRootFolder, implementation),
	);
	await sqs.sendMessagesToQueue(reduceEvents, process.env.SQS_REDUCER_URL);
	return reduceEvents;
};

const buildReduceEvent = (
	mapperOutputFileKeys: readonly string[],
	jobBucketName: string,
	implementation: string,
): ReduceEvent => {
	return {
		bucket: process.env.S3_BUCKET,
		outputFolder: REDUCER_FOLDER,
		jobRootFolder: jobBucketName,
		fileKeys: mapperOutputFileKeys,
		implementation: implementation,
		eventId: uuid(),
	};
};

const countOutputFiles = async (event: TriggerWatcherEvent): Promise<number> => {
	return await db.countFilesCompleted(event.jobRootFolder, event.folder);
};

const outputFileKeys = async (event: TriggerWatcherEvent): Promise<readonly string[]> => {
	return await db.getFilesKeys(event.jobRootFolder, event.folder);
};
