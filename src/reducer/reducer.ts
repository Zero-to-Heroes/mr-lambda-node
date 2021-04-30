/* eslint-disable @typescript-eslint/no-use-before-define */
import { getImplementation } from '../implementation/implementation';
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
	const reduceEvents: readonly ReduceEvent[] = ((event.Records as any[]) || [])
		.map(event => JSON.parse(event.body))
		.reduce((a, b) => a.concat(b), []);

	let currentReduceEvent = 0;
	for (const reduceEvent of reduceEvents) {
		const bucket = reduceEvent.bucket;
		const jobRoot = reduceEvent.jobRootFolder;
		const folder = reduceEvent.outputFolder;
		const eventId = reduceEvent.eventId;
		const fileName = 'reducer-' + eventId;
		if (await db.hasEntry(jobRoot, folder, eventId)) {
			console.warn('!! Multiple processing: entry already exists: ' + jobRoot + '/' + folder + '/' + eventId);
			continue;
		}
		try {
			await db.logEntry(jobRoot, folder, fileName, eventId, 'STARTED');
		} catch (e) {
			console.warn('Error while inserting entry in db: ' + jobRoot + '/' + folder + '/' + eventId);
			continue;
		}
		const output: ReduceOutput<any> = await processReduceEvent(reduceEvent);
		const finalOutput: ReduceOutput<any> =
			folder === 'result' ? await getImplementation(reduceEvent.implementation).transformOutput(output) : output;
		const fileKey: string = jobRoot + '/' + folder + '/' + fileName;
		const result = await s3.writeFile(finalOutput, bucket, fileKey);
		await db.updateEntry(jobRoot, folder, fileName, eventId, result ? 'WRITTEN_TO_S3' : 'ERROR_IN_S3');
		currentReduceEvent++;
	}
	return { statusCode: 200, body: '' };
};

const processReduceEvent = async (reduceEvent: ReduceEvent): Promise<ReduceOutput<any>> => {
	const fileContents = await Promise.all(
		reduceEvent.fileKeys.map(fileKey => loadFileContent(fileKey, reduceEvent.bucket)),
	);
	const reduceOutputs = (await Promise.all(fileContents.map(fileContent => toReduceOutput(fileContent)))).filter(
		reduceOutput => reduceOutput && reduceOutput.output,
	);
	let reduce: ReduceOutput<any> = {
		output: undefined,
	} as ReduceOutput<any>;
	let currentProcess = 0;
	for (const reduceOutput of reduceOutputs) {
		reduce = await getImplementation(reduceEvent.implementation).mergeReduceEvents(reduce, reduceOutput);
		currentProcess++;
	}
	return reduce;
};

const loadFileContent = async (fileKey: string, inputBucket: string): Promise<any> => {
	const strMapOutput = await s3.readContentAsString(inputBucket, fileKey);
	return strMapOutput ? JSON.parse(strMapOutput) : null;
};

const toReduceOutput = (mapOutput: MapOutput): ReduceOutput<any> => {
	return {
		output: mapOutput ? mapOutput.output : null,
	} as ReduceOutput<any>;
};
