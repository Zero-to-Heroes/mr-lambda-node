import { S3 as S3AWS } from 'aws-sdk';

export class S3 {
	private readonly s3: S3AWS;

	constructor() {
		this.s3 = new S3AWS({ region: 'us-west-2' });
	}

	// Since S3 is only eventually consistent, it's possible that we try to read a file that is not
	// available yet
	public async readContentAsString(bucketName: string, key: string): Promise<string> {
		return new Promise<string>(resolve => {
			this.readContentInternal(bucketName, key, result => resolve(result));
		});
	}

	private readContentInternal(bucketName: string, key: string, callback, retriesLeft = 10) {
		if (retriesLeft <= 0) {
			console.error('could not read s3 object', bucketName, key);
			callback(null);
			return;
		}
		const input = { Bucket: bucketName, Key: key };
		// console.log('getting s3 object', input);
		this.s3.getObject(input, (err, data) => {
			if (err) {
				// console.warn('could not read s3 object', bucketName, key, err, retriesLeft);
				setTimeout(() => {
					this.readContentInternal(bucketName, key, callback, retriesLeft - 1);
				}, 5000);
				return;
			}
			const objectContent = data.Body.toString('utf8');
			// console.log('read object content', bucketName, key);
			callback(objectContent);
		});
	}

	public async writeFile(content: any, bucket: string, fileName: string): Promise<boolean> {
		return new Promise<boolean>((resolve, reject) => {
			const input = {
				Body: JSON.stringify(content),
				Bucket: bucket,
				Key: fileName,
				ACL: 'public-read',
				ContentType: 'application/json',
			};
			this.s3.upload(input, (err, data) => {
				if (err) {
					console.error('could not upload file to S3', input, err);
					resolve(false);
					return;
				}
				resolve(true);
			});
		});
	}
}
