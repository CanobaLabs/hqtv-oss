import { Op, col, fn } from 'sequelize';
import ms from 'ms';
import { userDb } from '../../common/database/connections';
import Account from '../../common/database/userModels/account';
import ItemHistory from '../../common/database/userModels/itemHistory';
import HqError from '../../common/hqError';
import logger from '../../common/logger';
import redis from '../../common/redisClient';
import rKey from '../../common/redisKeys';
import adjustItemBalance from '../../common/utils/adjustItemBalance';
import { getUser } from '../../common/utils/userGetters';
import storeProductsSeed from '../storeProducts.json';

export interface StoreProductAward {
	itemType: string;
	quantity: number;
	[key: string]: unknown;
}

export interface StoreProductItem {
	sku: string;
	name: string;
	coinPrice: number;
	iconUrl: string;
	awards: StoreProductAward[];
	[key: string]: unknown;
}

export interface StorePlacementProduct {
	sku: string;
	backgroundColor?: string | null;
	highlighted?: boolean;
	accentColor?: string | null;
	label?: string | null;
	[key: string]: unknown;
}

export interface StorePlacementGroup {
	name: string;
	description?: string;
	itemType?: string;
	ctaText?: string;
	ctaUrl?: string;
	products: StorePlacementProduct[];
	[key: string]: unknown;
}

export interface StoreProducts {
	products: {
		items: StoreProductItem[];
		iap?: unknown[];
		[key: string]: unknown;
	};
	itemTypes: Record<string, {
		nameSingular: string;
		namePlural: string;
		iconUrl: string;
		[key: string]: unknown;
	}>;
	groupedPlacements: Record<string, StorePlacementGroup[]>;
	placements: Record<string, StorePlacementProduct[]>;
	[key: string]: unknown;
}

const STORE_PRODUCTS_KEY = rKey.storeProducts;

type ShopItemName = 'extra-life' | 'eraser' | 'super-spin' | 'free-life';
type DbItemName = 'lives' | 'erasers' | 'superSpins';

const SHOP_ITEM_TO_DB_ITEM: Record<ShopItemName, DbItemName> = {
	'extra-life': 'lives',
	'eraser': 'erasers',
	'super-spin': 'superSpins',
	'free-life': 'lives'
};

const DB_ITEM_TO_ITEM_TYPE: Record<DbItemName, ShopItemName> = {
	lives: 'extra-life',
	erasers: 'eraser',
	superSpins: 'super-spin'
};

type StoreMetricsWindowKey = 'allTime' | 'last30d' | 'last7d' | 'last24h';

export interface StoreMetricsTimeBucket {
	coinsSpent: number;
	purchases: number;
	uniquePurchasers: number;
	repeatPurchasers: number;
	averageCoinsPerPurchase: number;
}

export interface StoreItemMetric {
	item: string;
	itemType: string | null;
	name: string;
	quantity: number;
	purchases: number;
	uniquePurchasers: number;
	share: number;
}

export interface StoreSpenderMetric {
	userId: number;
	username: string | null;
	avatarUrl: string | null;
	coinsSpent: number;
	purchases: number;
	averageCoinsPerPurchase: number;
}

export interface StoreMetrics {
	totals: Record<StoreMetricsWindowKey, StoreMetricsTimeBucket>;
	coinsByDay: Array<{ date: string; coinsSpent: number; purchases: number; }>;
	popularItems: Record<StoreMetricsWindowKey, StoreItemMetric[]>;
	topSpenders: Record<StoreMetricsWindowKey, StoreSpenderMetric[]>;
}

const DEFAULT_STORE_PRODUCTS = validateStoreProductsShape(storeProductsSeed);

export interface StorePurchaseEntry {
	id: number;
	occurredAt: string;
	userId: number;
	username: string | null;
	avatarUrl: string | null;
	item: string;
	quantity: number;
	counted: boolean;
	broadcastId: number | null;
	seasonId: string | null;
}

export interface GetRecentStorePurchasesOptions {
	limit?: number;
	beforeId?: number;
}

export async function getRecentStorePurchases(
	options: GetRecentStorePurchasesOptions = {}
): Promise<StorePurchaseEntry[]> {
	const requestedLimit = typeof options.limit === 'number' && Number.isFinite(options.limit)
		? options.limit
		: undefined;
	const limit = requestedLimit === undefined
		? 50
		: Math.min(Math.max(Math.trunc(requestedLimit), 1), 200);
	const beforeId = typeof options.beforeId === 'number' && Number.isFinite(options.beforeId)
		? Math.trunc(options.beforeId)
		: undefined;

	const where: Record<string, unknown> = { reason: 'shop' };
	if (beforeId !== undefined) {
		where.id = { [Op.lt]: beforeId };
	}

	const purchases = await ItemHistory.findAll({
		where,
		order: [['id', 'DESC']],
		limit
	});

	const userIds = Array.from(new Set(purchases.map(purchase => purchase.userId)));
	const users = userIds.length > 0
		? await Account.findAll({
			where: { id: userIds }
		})
		: [];
	const userMeta = new Map(users.map(user => [user.id, {
		username: user.name ?? null,
		avatarUrl: user.avatarUrl ?? null
	}]));

	return purchases.map(purchase => ({
		id: purchase.id,
		occurredAt: new Date(purchase.date).toISOString(),
		userId: purchase.userId,
		username: userMeta.get(purchase.userId)?.username ?? null,
		avatarUrl: userMeta.get(purchase.userId)?.avatarUrl ?? null,
		item: purchase.item,
		quantity: purchase.qty,
		counted: Boolean(purchase.counted),
		broadcastId: purchase.broadcastId ?? null,
		seasonId: purchase.seasonId ?? null
	}));
}

export async function getStoreMetrics(): Promise<StoreMetrics> {
	const now = new Date();
	const nowMs = now.getTime();
	const storeProducts = await loadStoreProducts();
	const itemTypes = storeProducts.itemTypes ?? {};

	const windows: Array<{ key: StoreMetricsWindowKey; since?: Date; }> = [
		{ key: 'allTime' },
		{ key: 'last30d', since: new Date(nowMs - ms('30 days')) },
		{ key: 'last7d', since: new Date(nowMs - ms('7 days')) },
		{ key: 'last24h', since: new Date(nowMs - ms('24 hours')) },
	];

	const totals: Partial<Record<StoreMetricsWindowKey, StoreMetricsTimeBucket>> = {};
	const popularItems: Partial<Record<StoreMetricsWindowKey, StoreItemMetric[]>> = {};
	const rawTopSpenders: Partial<Record<StoreMetricsWindowKey, Array<{ userId: number; coinsSpent: number; purchases: number; }>>> = {};

	for (const window of windows) {
		const [totalBucket, itemMetrics, spenderRows] = await Promise.all([
			buildCoinTimeBucket(window.since),
			buildPopularItems(window.since, itemTypes),
			buildTopSpenders(window.since),
		]);
		totals[window.key] = totalBucket;
		popularItems[window.key] = itemMetrics;
		rawTopSpenders[window.key] = spenderRows;
	}

	const coinsByDay = await buildCoinsByDaySeries(now);

	const uniqueSpenderIds = new Set<number>();
	Object.values(rawTopSpenders).forEach((entries) => {
		entries?.forEach((entry) => uniqueSpenderIds.add(entry.userId));
	});

	const spenderProfiles = uniqueSpenderIds.size > 0
		? await Account.findAll({ where: { id: Array.from(uniqueSpenderIds) } })
		: [];
	const spenderMeta = new Map<number, { username: string | null; avatarUrl: string | null; }>(
		spenderProfiles.map((profile) => [profile.id, {
			username: profile.name ?? null,
			avatarUrl: profile.avatarUrl ?? null,
		}]),
	);

	const topSpenders: Partial<Record<StoreMetricsWindowKey, StoreSpenderMetric[]>> = {};
	for (const window of windows) {
		const rows = rawTopSpenders[window.key] ?? [];
		topSpenders[window.key] = rows.map((row) => {
			const meta = spenderMeta.get(row.userId);
			const averageCoinsPerPurchase = row.purchases > 0 ? row.coinsSpent / row.purchases : 0;
			return {
				userId: row.userId,
				username: meta?.username ?? null,
				avatarUrl: meta?.avatarUrl ?? null,
				coinsSpent: row.coinsSpent,
				purchases: row.purchases,
				averageCoinsPerPurchase,
			};
		});
	}

	return {
		totals: totals as Record<StoreMetricsWindowKey, StoreMetricsTimeBucket>,
		coinsByDay,
		popularItems: popularItems as Record<StoreMetricsWindowKey, StoreItemMetric[]>,
		topSpenders: topSpenders as Record<StoreMetricsWindowKey, StoreSpenderMetric[]>,
	};
}

export async function getStoreProducts(): Promise<StoreProducts> {
	const products = await loadStoreProducts();
	return clone(products);
}

export async function purchaseItem(userId: number, sku: string = '') {
	const storeProducts = await loadStoreProducts();

	const item = storeProducts.products.items.find(v => v.sku === sku);
	if (!item) {
		logger.info(`Invalid store item queried. UID=${userId}, SKU=${sku}`);
		throw new HqError('Item not found', 0, 404);
	}

	await userDb.transaction(async t => {
		const user = await getUser(userId, true, t); // must get user again to pass sql transaction // must use variable or it won't work - engine bug?
		if (item.coinPrice > user.coins) {
			logger.info(`Requested purchase with not enough coins. UID=${user.id}, SKU=${sku}, Balance=${user.coins}`);
			throw new HqError('Not enough coins', 0, 400);
		}

		// debit coins & award items
		const coinDebitValue = -1 * item.coinPrice;
		const itemCredits: { [currency: string]: number; } = { coins: coinDebitValue };
		item.awards.forEach(award => {
			const itemDbName = SHOP_ITEM_TO_DB_ITEM[award.itemType as ShopItemName] ?? award.itemType;
			itemCredits[itemDbName] = (itemCredits[itemDbName] ?? 0) + award.quantity;
		});
		await adjustItemBalance([user.id], itemCredits, { reason: 'shop' }, t);
	});

	const updatedUser = await getUser(userId, true);

	return {
		itemsPurchased: Object.fromEntries(
			item.awards.map(award => [award.itemType, award.quantity])
		),
		itemsTotal: Object.fromEntries(
			Object.entries(SHOP_ITEM_TO_DB_ITEM).map(([itemType, itemDbName]) => {
				return [itemType, updatedUser[itemDbName]];
			})
		),
		coinsTotal: updatedUser.coins,
		coinsPurchased: 0
	};
}

export async function replaceStoreProducts(payload: unknown, actorId?: string | number): Promise<StoreProducts> {
	const validated = validateStoreProductsShape(payload);
	const saved = await persistStoreProducts(validated);
	logger.info({
		context: 'store.replaceStoreProducts',
		actorId,
		itemCount: saved.products.items.length
	});
	return saved;
}

export async function upsertStoreProductItem(payload: unknown, actorId?: string | number): Promise<StoreProducts> {
	const item = validateStoreProductItem(payload, 'body');
	const storeProducts = await loadStoreProducts();
	const next = clone(storeProducts);
	const existingIndex = next.products.items.findIndex(existing => existing.sku === item.sku);
	if (existingIndex !== -1) {
		next.products.items[existingIndex] = item;
	} else {
		next.products.items.push(item);
	}
	const saved = await persistStoreProducts(next);
	logger.info({
		context: 'store.upsertStoreProductItem',
		actorId,
		sku: item.sku,
		action: existingIndex === -1 ? 'created' : 'updated'
	});
	return saved;
}

export async function removeStoreProductItem(sku: string, actorId?: string | number): Promise<StoreProducts> {
	if (typeof sku !== 'string' || sku.trim() === '') {
		throw new HqError('SKU is required', 0, 400);
	}
	const storeProducts = await loadStoreProducts();
	const next = clone(storeProducts);
	const index = next.products.items.findIndex(item => item.sku === sku);
	if (index === -1) {
		throw new HqError('Item not found', 0, 404);
	}

	next.products.items.splice(index, 1);
	cleanupPlacements(next, sku);

	const saved = await persistStoreProducts(next);
	logger.info({
		context: 'store.removeStoreProductItem',
		actorId,
		sku
	});
	return saved;
}

export async function resetStoreProductsToDefault(actorId?: string | number): Promise<StoreProducts> {
	const saved = await persistStoreProducts(DEFAULT_STORE_PRODUCTS);
	logger.info({
		context: 'store.resetStoreProductsToDefault',
		actorId
	});
	return saved;
}

async function loadStoreProducts(): Promise<StoreProducts> {
	try {
		const cached = await redis.get(STORE_PRODUCTS_KEY);
		if (cached) {
			const parsed = JSON.parse(cached);
			return validateStoreProductsShape(parsed);
		}
	} catch (error) {
		logger.error({
			context: 'store.loadStoreProducts.parseFailure',
			error
		});
	}

	const seeded = clone(DEFAULT_STORE_PRODUCTS);
	await redis.set(STORE_PRODUCTS_KEY, JSON.stringify(seeded));
	return seeded;
}

async function persistStoreProducts(payload: StoreProducts): Promise<StoreProducts> {
	const validated = validateStoreProductsShape(payload);
	await redis.set(STORE_PRODUCTS_KEY, JSON.stringify(validated));
	return clone(validated);
}

function cleanupPlacements(data: StoreProducts, sku: string) {
	for (const placementKey of Object.keys(data.placements)) {
		const current = data.placements[placementKey];
		if (Array.isArray(current)) {
			data.placements[placementKey] = current.filter(entry => entry.sku !== sku);
		}
	}
	for (const groupKey of Object.keys(data.groupedPlacements)) {
		const groups = data.groupedPlacements[groupKey];
		if (Array.isArray(groups)) {
			data.groupedPlacements[groupKey] = groups.map(group => ({
				...group,
				products: Array.isArray(group.products) ? group.products.filter(product => product.sku !== sku) : []
			}));
		}
	}
}

function validateStoreProductsShape(payload: unknown): StoreProducts {
	if (!isObject(payload)) {
		throw new HqError('Invalid store products payload', 0, 400);
	}
	const cloned = clone(payload) as Record<string, unknown>;

	if (!isObject(cloned.products)) {
		throw new HqError('`products` is required', 0, 400);
	}

	const productsRecord = cloned.products as Record<string, unknown>;
	if (!Array.isArray(productsRecord.items)) {
		throw new HqError('`products.items` must be an array', 0, 400);
	}

	const seenSkus = new Set<string>();
	const validatedItems = productsRecord.items.map((item, index) => validateStoreProductItem(item, `products.items[${index}]`, seenSkus));

	const validatedProducts: StoreProducts['products'] = {
		...productsRecord,
		items: validatedItems,
		iap: Array.isArray(productsRecord.iap) ? clone(productsRecord.iap) : []
	};

	if (Array.isArray((productsRecord as Record<string, unknown>).buyBackInItem)) {
		validatedProducts.buyBackInItem = clone((productsRecord as Record<string, unknown>).buyBackInItem);
	}
	if (Array.isArray((productsRecord as Record<string, unknown>).buyBackInBundle)) {
		validatedProducts.buyBackInBundle = clone((productsRecord as Record<string, unknown>).buyBackInBundle);
	}

	const validatedItemTypes: StoreProducts['itemTypes'] = {};
	if (cloned.itemTypes !== undefined) {
		if (!isObject(cloned.itemTypes)) {
			throw new HqError('`itemTypes` must be an object', 0, 400);
		}
		for (const [key, raw] of Object.entries(cloned.itemTypes)) {
			if (!isObject(raw)) {
				throw new HqError(`itemTypes.${key} must be an object`, 0, 400);
			}
			validatedItemTypes[key] = {
				...raw,
				nameSingular: ensureString(raw.nameSingular, `itemTypes.${key}.nameSingular`),
				namePlural: ensureString(raw.namePlural, `itemTypes.${key}.namePlural`),
				iconUrl: ensureString(raw.iconUrl, `itemTypes.${key}.iconUrl`)
			};
		}
	}

	const validatedGroupedPlacements: StoreProducts['groupedPlacements'] = {};
	if (cloned.groupedPlacements !== undefined) {
		if (!isObject(cloned.groupedPlacements)) {
			throw new HqError('`groupedPlacements` must be an object', 0, 400);
		}
		for (const [key, raw] of Object.entries(cloned.groupedPlacements)) {
			if (!Array.isArray(raw)) {
				throw new HqError(`groupedPlacements.${key} must be an array`, 0, 400);
			}
			validatedGroupedPlacements[key] = raw.map((group, groupIndex) => validatePlacementGroup(group, `${key}[${groupIndex}]`));
		}
	}

	const validatedPlacements: StoreProducts['placements'] = {};
	if (cloned.placements !== undefined) {
		if (!isObject(cloned.placements)) {
			throw new HqError('`placements` must be an object', 0, 400);
		}
		for (const [key, raw] of Object.entries(cloned.placements)) {
			if (!Array.isArray(raw)) {
				throw new HqError(`placements.${key} must be an array`, 0, 400);
			}
			validatedPlacements[key] = raw.map((placement, placementIndex) =>
				validatePlacementProduct(placement, `placements.${key}[${placementIndex}]`)
			);
		}
	}

	return {
		...cloned,
		products: validatedProducts,
		itemTypes: validatedItemTypes,
		groupedPlacements: validatedGroupedPlacements,
		placements: validatedPlacements
	};
}

function validateStoreProductItem(
	value: unknown,
	path: string,
	seenSkus: Set<string> = new Set()
): StoreProductItem {
	if (!isObject(value)) {
		throw new HqError(`${path} must be an object`, 0, 400);
	}
	const sku = ensureString(value.sku, `${path}.sku`);
	if (seenSkus.has(sku)) {
		throw new HqError(`Duplicate SKU detected: ${sku}`, 0, 400);
	}
	seenSkus.add(sku);

	const name = ensureString(value.name, `${path}.name`);
	const iconUrl = ensureString(value.iconUrl, `${path}.iconUrl`);
	const coinPrice = ensureNumber(value.coinPrice, `${path}.coinPrice`, 0);

	if (!Array.isArray(value.awards) || value.awards.length === 0) {
		throw new HqError(`${path}.awards must be a non-empty array`, 0, 400);
	}
	const awards = value.awards.map((award, awardIndex) => validateAward(award, `${path}.awards[${awardIndex}]`));

	return {
		...value,
		sku,
		name,
		iconUrl,
		coinPrice,
		awards
	};
}

function validateAward(value: unknown, path: string): StoreProductAward {
	if (!isObject(value)) {
		throw new HqError(`${path} must be an object`, 0, 400);
	}
	const itemType = ensureString(value.itemType, `${path}.itemType`);
	const quantity = ensureNumber(value.quantity, `${path}.quantity`, 0);
	return {
		...value,
		itemType,
		quantity
	};
}

function validatePlacementGroup(value: unknown, path: string): StorePlacementGroup {
	if (!isObject(value)) {
		throw new HqError(`groupedPlacements.${path} must be an object`, 0, 400);
	}
	if (!Array.isArray(value.products)) {
		throw new HqError(`groupedPlacements.${path}.products must be an array`, 0, 400);
	}
	return {
		...value,
		name: ensureString(value.name, `groupedPlacements.${path}.name`),
		description: value.description === undefined ? undefined : ensureString(value.description, `groupedPlacements.${path}.description`, true),
		itemType: value.itemType === undefined ? undefined : ensureString(value.itemType, `groupedPlacements.${path}.itemType`, true),
		ctaText: value.ctaText === undefined ? undefined : ensureString(value.ctaText, `groupedPlacements.${path}.ctaText`, true),
		ctaUrl: value.ctaUrl === undefined ? undefined : ensureString(value.ctaUrl, `groupedPlacements.${path}.ctaUrl`, true),
		products: value.products.map((product, index) => validatePlacementProduct(product, `groupedPlacements.${path}.products[${index}]`))
	};
}

function validatePlacementProduct(value: unknown, path: string): StorePlacementProduct {
	if (!isObject(value)) {
		throw new HqError(`${path} must be an object`, 0, 400);
	}
	return {
		...value,
		sku: ensureString(value.sku, `${path}.sku`),
		backgroundColor: value.backgroundColor === undefined || value.backgroundColor === null
			? value.backgroundColor ?? null
			: ensureString(value.backgroundColor, `${path}.backgroundColor`, true),
		label: value.label === undefined || value.label === null
			? value.label ?? null
			: ensureString(value.label, `${path}.label`, true),
		accentColor: value.accentColor === undefined || value.accentColor === null
			? value.accentColor ?? null
			: ensureString(value.accentColor, `${path}.accentColor`, true),
		highlighted: value.highlighted === undefined ? value.highlighted : Boolean(value.highlighted)
	};
}

function ensureString(value: unknown, path: string, allowEmpty = false): string {
	if (typeof value !== 'string') {
		throw new HqError(`${path} must be a string`, 0, 400);
	}
	if (!allowEmpty && value.trim() === '') {
		throw new HqError(`${path} cannot be empty`, 0, 400);
	}
	return value;
}

function ensureNumber(value: unknown, path: string, min?: number): number {
	if (typeof value !== 'number' || Number.isNaN(value)) {
		throw new HqError(`${path} must be a number`, 0, 400);
	}
	if (min !== undefined && value < min) {
		throw new HqError(`${path} must be at least ${min}`, 0, 400);
	}
	return value;
}

function isObject(value: unknown): value is Record<string, any> {
	return typeof value === 'object' && value !== null;
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value));
}

function buildCoinTimeBucket(since?: Date): Promise<StoreMetricsTimeBucket> {
	const where = buildCoinPurchaseWhere(since);

	return Promise.all([
		ItemHistory.sum('qty', { where }),
		ItemHistory.count({ where }),
		ItemHistory.count({ where, distinct: true, col: 'userId' }),
		ItemHistory.findAll({
			attributes: [
				'userId',
				[fn('COUNT', col('*')), 'purchaseCount'],
			],
			where,
			group: ['userId'],
			raw: true,
		}),
	]).then(([coinsSumRaw, purchasesRaw, uniquePurchasersRaw, repeatRowsRaw]) => {
		const purchases = Number(purchasesRaw ?? 0);
		const coinsSpent = Math.abs(Number(coinsSumRaw ?? 0));
		const uniquePurchasers = Number(uniquePurchasersRaw ?? 0);

		const repeatPurchasers = Array.isArray(repeatRowsRaw)
			? repeatRowsRaw.reduce((count, row) => {
				const record = row as unknown as Record<string, unknown>;
				const purchaseCountValue = record['purchaseCount'] ?? record['COUNT(*)'];
				const purchaseCount = Number(purchaseCountValue ?? 0);
				return count + (purchaseCount >= 2 ? 1 : 0);
			}, 0)
			: 0;

		const averageCoinsPerPurchase = purchases > 0 ? coinsSpent / purchases : 0;

		return {
			coinsSpent,
			purchases,
			uniquePurchasers,
			repeatPurchasers,
			averageCoinsPerPurchase,
		};
	});
}

async function buildPopularItems(
	since: Date | undefined,
	itemTypes: StoreProducts['itemTypes'],
): Promise<StoreItemMetric[]> {
	const where = buildItemAwardWhere(since);
	const rows = await ItemHistory.findAll({
		attributes: [
			'item',
			[fn('SUM', col('qty')), 'totalQuantity'],
			[fn('COUNT', col('*')), 'entryCount'],
			[fn('COUNT', fn('DISTINCT', col('userId'))), 'uniquePurchasers'],
		],
		where,
		group: ['item'],
		order: [[col('totalQuantity'), 'DESC']],
		limit: 10,
		raw: true,
	});

	const totalQuantity = rows.reduce((sum, row) => sum + Math.max(0, Number((row as { totalQuantity?: number }).totalQuantity ?? 0)), 0);

	return rows.map((row) => {
		const item = String((row as { item?: string }).item ?? '');
		const quantity = Math.max(0, Number((row as { totalQuantity?: number }).totalQuantity ?? 0));
		const purchases = Math.max(0, Number((row as { entryCount?: number }).entryCount ?? 0));
		const uniquePurchasers = Math.max(0, Number((row as { uniquePurchasers?: number }).uniquePurchasers ?? 0));
		const itemTypeKey = DB_ITEM_TO_ITEM_TYPE[item as DbItemName] ?? null;
		const itemTypeConfig = itemTypeKey ? itemTypes?.[itemTypeKey] : undefined;

		let name: string;
		if (itemTypeConfig?.namePlural) {
			name = itemTypeConfig.namePlural;
		} else if (itemTypeConfig?.nameSingular) {
			name = itemTypeConfig.nameSingular;
		} else {
			name = itemTypeKey ?? item;
		}

		const share = totalQuantity > 0 ? quantity / totalQuantity : 0;

		return {
			item,
			itemType: itemTypeKey,
			name,
			quantity,
			purchases,
			uniquePurchasers,
			share,
		};
	});
}

function buildTopSpenders(since?: Date): Promise<Array<{ userId: number; coinsSpent: number; purchases: number; }>> {
	const where = buildCoinPurchaseWhere(since);
	return ItemHistory.findAll({
		attributes: [
			'userId',
			[fn('SUM', col('qty')), 'totalCoins'],
			[fn('COUNT', col('*')), 'purchaseCount'],
		],
		where,
		group: ['userId'],
		order: [[col('totalCoins'), 'ASC']],
		limit: 10,
		raw: true,
	}).then((rows) =>
		rows.map((row) => {
			const totalCoinsRaw = Number((row as { totalCoins?: number }).totalCoins ?? 0);
			const purchases = Math.max(0, Number((row as { purchaseCount?: number }).purchaseCount ?? 0));
			return {
				userId: Number((row as { userId?: number }).userId ?? 0),
				coinsSpent: Math.abs(totalCoinsRaw),
				purchases,
			};
		}),
	);
}

async function buildCoinsByDaySeries(referenceDate: Date): Promise<Array<{ date: string; coinsSpent: number; purchases: number; }>> {
	const dayMs = ms('1 day');
	const startOfToday = startOfUtcDay(referenceDate);
	const startRange = new Date(startOfToday.getTime() - dayMs * 6);
	const where = buildCoinPurchaseWhere(startRange);

	const rows = await ItemHistory.findAll({
		attributes: [
			[fn('DATE', col('date')), 'day'],
			[fn('SUM', col('qty')), 'totalCoins'],
			[fn('COUNT', col('*')), 'purchaseCount'],
		],
		where,
		group: [fn('DATE', col('date'))],
		order: [[fn('DATE', col('date')), 'ASC']],
		raw: true,
	});

	const dailyMap = new Map<string, { coinsSpent: number; purchases: number; }>();
	rows.forEach((row) => {
		const rawDate = String((row as { day?: string }).day ?? '');
		const coinsSpent = Math.abs(Number((row as { totalCoins?: number }).totalCoins ?? 0));
		const purchases = Math.max(0, Number((row as { purchaseCount?: number }).purchaseCount ?? 0));
		if (rawDate) {
			const normalizedDate = normalizeDateKey(rawDate);
			dailyMap.set(normalizedDate, { coinsSpent, purchases });
		}
	});

	return Array.from({ length: 7 }, (_, idx) => {
		const bucketStart = startRange.getTime() + dayMs * idx;
		const date = new Date(bucketStart).toISOString().slice(0, 10);
		const entry = dailyMap.get(date);
		return {
			date,
			coinsSpent: entry?.coinsSpent ?? 0,
			purchases: entry?.purchases ?? 0,
		};
	});
}

function buildCoinPurchaseWhere(since?: Date): Record<string, unknown> {
	const where: Record<string, unknown> = {
		reason: 'shop',
		item: 'coins',
		qty: { [Op.lt]: 0 },
	};
	if (since) {
		where.date = { [Op.gte]: since };
	}
	return where;
}

function buildItemAwardWhere(since?: Date): Record<string, unknown> {
	const where: Record<string, unknown> = {
		reason: 'shop',
		item: { [Op.ne]: 'coins' },
		qty: { [Op.gt]: 0 },
	};
	if (since) {
		where.date = { [Op.gte]: since };
	}
	return where;
}

function startOfUtcDay(date: Date): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function normalizeDateKey(value: string): string {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return value;
	}
	return parsed.toISOString().slice(0, 10);
}
