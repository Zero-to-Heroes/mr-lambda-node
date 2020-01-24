import { MiniReview } from '../models/mini-review';
import { http } from './utils';

const REVIEW_API = 'https://www.zerotoheroes.com/api/reviews/';

export class ReviewDao {
	public async getMiniReview(reviewId: string): Promise<MiniReview> {
		const review: any = await http(REVIEW_API + reviewId);
		console.log('retrieved review', review);
		return review;
	}
}
