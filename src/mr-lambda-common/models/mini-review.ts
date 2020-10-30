export interface MiniReview {
	readonly id: string;
	readonly userId: string;
	readonly result: 'won' | 'lost' | 'tied';
	readonly replayKey: string;
	readonly playerCardId: string;
	readonly playerClass: string;
	readonly additionalResult: string;
	readonly playerDecklist: string;
	readonly creationDate: Date;
}
