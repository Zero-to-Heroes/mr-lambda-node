import { MiniReview } from '../models/mini-review';
import { http } from './utils';

// const REVIEW_API = 'https://www.zerotoheroes.com/api/reviews/';

export class ReviewDao {
	public async getMiniReview(reviewId: string): Promise<MiniReview> {
		// console.log('getting review', reviewId);
		const review: any = await http(`https://nj8w9uc6p5.execute-api.us-west-2.amazonaws.com/Prod/${reviewId}`);
		// console.log('retrieved review', review);
		return JSON.parse(review);
	}
}
