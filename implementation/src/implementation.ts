import { MiniReview } from '../../mr-lambda-common/src/models/mini-review';
import { ReduceOutput } from '../../mr-lambda-common/src/models/reduce-output';
import { TestImplementation } from './impl/test-implementation';

export interface Implementation {
	mergeReduceEvents(currentResult: ReduceOutput, newResult: ReduceOutput): Promise<ReduceOutput>;
	loadReviewIds(): Promise<readonly string[]>;
	extractMetric(replayAsString: string, miniReview: MiniReview): Promise<any>;
}

const currentImplementation: Implementation = new TestImplementation();

export { currentImplementation as implementation };
