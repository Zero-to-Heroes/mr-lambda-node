/* eslint-disable @typescript-eslint/no-use-before-define */
import { Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { AllCardsService, BlockType } from '@firestone-hs/reference-data';
import { MiniReview } from '../../../mr-lambda-common/models/mini-review';
import { ReduceOutput } from '../../../mr-lambda-common/models/reduce-output';
import { getConnection } from '../../../mr-lambda-common/services/rds';
import { http } from '../../../mr-lambda-common/services/utils';
import { Implementation } from '../../implementation';

export class BgMasterNguyenHpDiscovers implements Implementation<Output> {
	public async loadReviewIds(query: string): Promise<readonly string[]> {
		const lastBattlegroundsPatch = await getLastBattlegroundsPatch();
		const mysql = await getConnection();

		const defaultQuery = `
			SELECT reviewId FROM replay_summary
			WHERE gameMode = 'battlegrounds'
			AND buildNumber >= ${lastBattlegroundsPatch}
			AND creationDate > DATE_SUB(NOW(), INTERVAL 10 DAY)
			AND playerCardId = 'BG20_HERO_202'
			ORDER BY creationDate DESC
		`;
		query = query || defaultQuery;
		const dbResults: any[] = await mysql.query(query);
		const result = dbResults.map(result => result.reviewId);
		return result;
	}

	public async extractMetric(replay: Replay, miniReview: MiniReview): Promise<Output> {
		if (!replay) {
			console.warn('empty replay');
			return null;
		}

		try {
			const elementTree = replay.replay;
			// Also includes opponent, but not an issue
			const powerOfTheStormsTriggerEntities = elementTree.findall(`.//FullEntity[@cardID='BG20_HERO_202pt']`);
			const entityIds = powerOfTheStormsTriggerEntities.map(entity => entity.get('id'));
			if (!entityIds?.length) {
				return null;
			}

			const heroPowerTriggerBlocks = elementTree
				.findall(`.//Block[@type="${BlockType.POWER}"]`)
				.filter(block => entityIds.includes(block.get('entity')));
			if (!heroPowerTriggerBlocks?.length) {
				return null;
			}

			const outputChoices: Output = {
				choices: {},
				picks: {},
			} as Output;
			for (const block of heroPowerTriggerBlocks) {
				const choices = block.find(`.//Choices`);
				const choiceOptions = choices.findall(`.//Choice`);
				const fullEntities = block.findall(`.//FullEntity`);
				const fullEntitiesInChoices = choiceOptions
					.map(choice => choice.get('entity'))
					.map(choiceEntityId => fullEntities.find(entity => entity.get('id') === choiceEntityId));
				for (const choice of choiceOptions) {
					const cardId = fullEntitiesInChoices
						.find(entity => entity.get('id') === choice.get('entity'))
						.get('cardID');
					outputChoices.choices[cardId] = (outputChoices.choices[cardId] || 0) + 1;
				}

				const picks = block.find(`.//ChosenEntities`);
				const pick = picks.find(`.//Choice`);
				const fullEntitiesInPick = fullEntities.find(entity => entity.get('id') === pick.get('entity'));
				const pickCardId = fullEntitiesInPick.get('cardID');
				outputChoices.picks[pickCardId] = (outputChoices.picks[pickCardId] || 0) + 1;
			}

			return outputChoices;
		} catch (e) {
			console.error('error while parsing', e, miniReview);
			return null;
		}
	}

	public async mergeReduceEvents(
		currentResult: ReduceOutput<Output>,
		newResult: ReduceOutput<Output>,
	): Promise<ReduceOutput<Output>> {
		if (!currentResult) {
			return newResult;
		}
		if (!newResult) {
			return currentResult;
		}
		return {
			output: this.mergeOutputs(currentResult.output, newResult.output),
		} as ReduceOutput<Output>;
	}

	private mergeOutputs(inputResult: Output, newResult: Output): Output {
		if (!inputResult) {
			return newResult;
		}
		if (!newResult) {
			return inputResult;
		}

		const output: Output = {
			choices: merge(inputResult.choices, newResult.choices),
			picks: merge(inputResult.picks, newResult.picks),
		} as Output;

		return output;
	}

	public async transformOutput(output: ReduceOutput<Output>): Promise<ReduceOutput<any>> {
		const cards = new AllCardsService();
		await cards.initializeCardsDb();
		const totalChoices = Object.values(output.output.choices).reduce((a, b) => a + b, 0);
		const totalPicks = Object.values(output.output.picks).reduce((a, b) => a + b, 0);
		return {
			output: {
				choices: Object.keys(output.output.choices).map(cardId => {
					const card = cards.getCard(cardId);
					return {
						cardId,
						cardName: card.name,
						count: output.output.choices[cardId],
						percentage: output.output.choices[cardId] / totalChoices,
					};
				}),
				picks: Object.keys(output.output.picks).map(cardId => {
					const card = cards.getCard(cardId);
					return {
						cardId,
						cardName: card.name,
						count: output.output.picks[cardId],
						percentage: output.output.picks[cardId] / totalPicks,
					};
				}),
			},
		};
	}
}

const merge = (
	inputResult: { [cardId: string]: number },
	newResult: { [cardId: string]: number },
): { [cardId: string]: number } => {
	const result = {};
	const existingCurrentResultKeys = Object.keys(inputResult);
	for (const key of existingCurrentResultKeys) {
		result[key] = (inputResult[key] ?? 0) + (newResult[key] ?? 0);
	}
	// Might do the same thing twice, but it's clearer that way
	for (const key of Object.keys(newResult)) {
		if (existingCurrentResultKeys.includes(key)) {
			continue;
		}
		result[key] = (inputResult[key] ?? 0) + (newResult[key] ?? 0);
	}
	return result;
};

export const getLastBattlegroundsPatch = async (): Promise<number> => {
	const patchInfo = await http(`https://static.zerotoheroes.com/hearthstone/data/patches.json`);
	const structuredPatch = JSON.parse(patchInfo);
	return structuredPatch.currentBattlegroundsMetaPatch;
};

interface Output {
	readonly choices: { [cardId: string]: number };
	readonly picks: { [cardId: string]: number };
}

interface Choice {
	readonly options: readonly string[];
	readonly pick: string;
}
