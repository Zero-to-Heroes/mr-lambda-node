import { MiniReview } from '../../mr-lambda-common/src/models/mini-review';
import { TestImplementation } from './impl/test-implementation';

export interface Implementation {
	loadReviewIds(): Promise<readonly string[]>;
	extractMetric(replayAsString: string, miniReview: MiniReview): Promise<any>;
}

const currentImplementation: Implementation = new TestImplementation();

export { currentImplementation as implementation };

