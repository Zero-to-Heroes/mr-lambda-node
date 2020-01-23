import { S3 as S3AWS } from 'aws-sdk';

export class S3 {
	private readonly s3: S3AWS;

	constructor() {
		this.s3 = new S3AWS({ region: 'us-west-2' });
	}

	public async readContentAsString(bucketName: string, key: string): Promise<string> {
		return new Promise<string>(resolve => {
			this.s3.getObject({ Bucket: bucketName, Key: key }, (err, data) => {
				if (err) {
					console.error('could not read s3 object', bucketName, key, err);
					resolve(null);
					return;
				}
				const objectContent = data.Body.toString('utf8');
				console.log('read object content', bucketName, key, objectContent);
				resolve(objectContent);
			});
		});
	}

	public async writeFile(content: any, bucket: string, fileName: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.s3.upload(
				{
					Body: content,
					Bucket: bucket,
					Key: fileName,
					ACL: 'public-read',
				},
				(err, data) => {
					if (err) {
						console.error('could not upload file to S3', bucket, fileName, content, err);
						resolve();
						return;
					}
					resolve();
				},
			);
		});
	}
}
