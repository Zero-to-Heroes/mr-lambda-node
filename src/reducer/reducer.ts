/* eslint-disable @typescript-eslint/no-use-before-define */
import { implementation } from '../implementation/implementation';
import { MapOutput } from '../mr-lambda-common/models/map-output';
import { ReduceEvent } from '../mr-lambda-common/models/reduce-event';
import { ReduceOutput } from '../mr-lambda-common/models/reduce-output';
import { Db } from '../mr-lambda-common/services/db';
import { S3 } from '../mr-lambda-common/services/s3';

const db = new Db();
const s3 = new S3();

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event): Promise<any> => {
	console.log('event', event);
	const reduceEvents: readonly ReduceEvent[] = (event.Records as any[])
		.map(event => JSON.parse(event.body))
		.reduce((a, b) => a.concat(b), []);
	console.log('handling', reduceEvents.length, 'reduce events');

	let currentReduceEvent = 0;
	for (const reduceEvent of reduceEvents) {
		currentReduceEvent++;
		console.log('Processing reduce event ' + currentReduceEvent + '/' + reduceEvents.length);
		const bucket = reduceEvent.bucket;
		const jobRoot = reduceEvent.jobRootFolder;
		const folder = reduceEvent.outputFolder;
		const eventId = reduceEvent.eventId;
		const fileName = 'reducer-' + eventId;
		if (await db.hasEntry(jobRoot, folder, eventId)) {
			console.log('!! Multiple processing: entry already exists: ' + jobRoot + '/' + folder + '/' + eventId);
			continue;
		}
		try {
			await db.logEntry(jobRoot, folder, fileName, eventId, 'STARTED');
		} catch (e) {
			console.log('Error while inserting entry in db: ' + jobRoot + '/' + folder + '/' + eventId);
			continue;
		}
		const output: ReduceOutput = await processReduceEvent(reduceEvent);
		const fileKey: string = jobRoot + '/' + folder + '/' + fileName;
		console.log('Writing file ' + fileKey + ' with contents ' + output + ' to bucket ' + bucket);
		await s3.writeFile(output, bucket, fileKey);
		await db.updateEntry(jobRoot, folder, fileName, eventId, 'WRITTEN_TO_S3');
	}
	return { statusCode: 200, body: '' };
};

const processReduceEvent = async (reduceEvent: ReduceEvent): Promise<ReduceOutput> => {
	console.log('procesing reduce event', reduceEvent);
	const fileContents = await Promise.all(
		reduceEvent.fileKeys.map(fileKey => loadFileContent(fileKey, reduceEvent.bucket)),
	);
	const reduceOutputs = await Promise.all(fileContents.map(fileContent => toReduceOutput(fileContent)));
	let reduce: ReduceOutput = {} as ReduceOutput;
	for (const reduceOutput of reduceOutputs) {
		reduce = await implementation.mergeReduceEvents(reduce, reduceOutput);
	}
	console.log('processed event', reduce);
	return reduce;
};

const loadFileContent = async (fileKey: string, inputBucket: string): Promise<any> => {
	const strMapOutput = await s3.readContentAsString(inputBucket, fileKey);
	return JSON.parse(strMapOutput);
};

const toReduceOutput = (mapOutput: MapOutput): ReduceOutput => {
	return {
		output: mapOutput.output,
	} as ReduceOutput;
};
