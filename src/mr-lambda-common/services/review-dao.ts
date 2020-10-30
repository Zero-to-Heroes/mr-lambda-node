import { MiniReview } from '../models/mini-review';
import { getConnection } from './rds';

// const REVIEW_API = 'https://www.zerotoheroes.com/api/reviews/';

export class ReviewDao {
	public async getMiniReview(reviewId: string): Promise<MiniReview> {
		const mysql = await getConnection();
		const dbResults: readonly any[] = await mysql.query(
			`
				SELECT * FROM replay_summary 
				WHERE reviewId = '${reviewId}'
			`,
		);
		const review = dbResults && dbResults.length > 0 ? dbResults[0] : null;
		return review
			? ({
					id: review.reviewId,
					result: review.result,
					userId: review.userId,
					playerCardId: review.playerCardId,
					replayKey: review.replayKey,
					additionalResult: review.additionalResult,
					creationDate: review.creationDate,
					playerDecklist: review.playerDecklist,
					playerClass: review.playerClass,
			  } as MiniReview)
			: null;
	}
}
