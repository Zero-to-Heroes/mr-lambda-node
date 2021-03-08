/* eslint-disable @typescript-eslint/no-use-before-define */
import { getImplementation } from '../implementation/implementation';
import { MapEvent } from '../mr-lambda-common/models/map-event';
import { TriggerWatcherEvent } from '../mr-lambda-common/models/trigger-watcher-event';
import { Sqs } from '../mr-lambda-common/services/sqs';
import { partitionArray } from '../mr-lambda-common/services/utils';

const MAPPER_FOLDER = 'mapper';
const REVIEWS_PER_MAPPER = 25;
const MAX_MAPPERS = 150;
const MAX_REVIEWS_PER_MAPPER = 100;

const sqs = new Sqs();

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event): Promise<any> => {
	console.log('event', JSON.stringify(event, null, 4));
	const jobName: string = event.jobName;
	const query: string = event.query;
	const implementation: string = event.implementation;
	const jobBucketName = jobName + '-' + new Date().toISOString();
	console.log('starting map/reduce on lambda', jobName);
	const reviewIds: readonly string[] = await getImplementation(implementation).loadReviewIds(query);
	console.log('will handle', reviewIds.length, 'reviews');
	await startMappingPhase(reviewIds, jobBucketName, implementation);
	console.log('mapping phase trigger sent');
	await sqs.sendMessageToQueue(
		{
			bucket: process.env.S3_BUCKET,
			folder: MAPPER_FOLDER,
			jobRootFolder: jobBucketName,
			expectedNumberOfFiles: reviewIds.length,
			implementation: implementation,
		} as TriggerWatcherEvent,
		process.env.SQS_MAPPER_WATCHER_URL,
	);
	console.log('sent notification to start mapper watcher');
	return { statusCode: 200, body: '' };
};

const startMappingPhase = async (reviewIds: readonly string[], jobBucketName: string, implementation: string) => {
	console.log('about to handle', reviewIds.length, 'files');
	const reviewsPerMapper = Math.min(
		MAX_REVIEWS_PER_MAPPER,
		Math.ceil(Math.max(REVIEWS_PER_MAPPER, reviewIds.length / MAX_MAPPERS)),
	);
	console.log('reviewsPerMapper', reviewsPerMapper);
	const idsPerMapper: readonly string[][] = partitionArray(reviewIds, reviewsPerMapper);
	console.log('idsPerMapper', idsPerMapper.length);
	const mapEvents = idsPerMapper.map(idsForMapper => buildSqsMapEvents(idsForMapper, jobBucketName, implementation));
	console.log('mapEvents', mapEvents.length);
	await sqs.sendMessagesToQueue(mapEvents, process.env.SQS_MAPPER_URL);
	console.log('sent all SQS messages to mapper');
};

const buildSqsMapEvents = (reviewIds: readonly string[], jobBucketName: string, implementation: string) => {
	return {
		reviewIds: reviewIds,
		bucket: process.env.S3_BUCKET,
		jobRootFolder: jobBucketName,
		folder: MAPPER_FOLDER,
		implementation: implementation,
	} as MapEvent;
};
