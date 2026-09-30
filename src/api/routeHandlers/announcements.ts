import Audit from '../../common/database/adminModels/audit';
import HqError from '../../common/hqError';
import redis from '../../common/redisClient';
import rKey from '../../common/redisKeys';

const AUDIT_DESCRIPTION_MAX_LENGTH = 1000;

type Announcement = {
	active: boolean;
	height: number;
	width: number;
	type: string;
	vertical: string;
	gameType: string;
	bgImageUrl: string;
	bgVideoUrl: string;
	name: string;
	iosOnly?: boolean;
};

function formatAuditDescription(action: string, details: Record<string, unknown>): string {
	const base = `${action}: ${JSON.stringify(details)}`;
	if (base.length <= AUDIT_DESCRIPTION_MAX_LENGTH) {
		return base;
	}
	return `${base.slice(0, AUDIT_DESCRIPTION_MAX_LENGTH - 3)}...`;
}

async function logAnnouncementChange(options: {
	action: string;
	employeeId: string | number;
	details: Record<string, unknown>;
	announcementIndex?: number;
}) {
	await Audit.create({
		to: 'announcements',
		toType: 'config',
		subTo: options.announcementIndex !== undefined ? String(options.announcementIndex) : 'all',
		subToType: 'announcement',
		from: String(options.employeeId),
		fromType: 'employee',
		action: options.action,
		description: formatAuditDescription(options.action, options.details)
	});
}

function validateAnnouncement(body: unknown): Announcement {
	if (!body || typeof body !== 'object' || Array.isArray(body)) {
		throw new HqError('Request body must be an object', 0, 400);
	}

	const input = body as Record<string, unknown>;

	if (typeof input.active !== 'boolean') {
		throw new HqError('active must be a boolean', 0, 400);
	}
	if (typeof input.height !== 'number' || !Number.isFinite(input.height)) {
		throw new HqError('height must be a finite number', 0, 400);
	}
	if (typeof input.width !== 'number' || !Number.isFinite(input.width)) {
		throw new HqError('width must be a finite number', 0, 400);
	}
	// type, vertical, and gameType are fixed values and cannot be set by users
	if (typeof input.bgImageUrl !== 'string') {
		throw new HqError('bgImageUrl must be a string', 0, 400);
	}
	if (typeof input.bgVideoUrl !== 'string') {
		throw new HqError('bgVideoUrl must be a string', 0, 400);
	}
	if (typeof input.name !== 'string') {
		throw new HqError('name must be a string', 0, 400);
	}
	if (input.iosOnly !== undefined && typeof input.iosOnly !== 'boolean') {
		throw new HqError('iosOnly must be a boolean', 0, 400);
	}

	return {
		active: input.active,
		height: input.height,
		width: input.width,
		type: 'referral', // Fixed value - cannot be changed
		vertical: 'general', // Fixed value - cannot be changed
		gameType: 'trivia', // Fixed value - cannot be changed
		bgImageUrl: input.bgImageUrl,
		bgVideoUrl: input.bgVideoUrl,
		name: input.name,
		iosOnly: input.iosOnly ?? false
	};
}

export async function getAnnouncements(): Promise<{ announcements: Announcement[] }> {
	const announcements = (await redis.json.get(rKey.announcements) ?? []) as Announcement[];
	return { announcements };
}

export async function createAnnouncement(employeeId: string | number, body: unknown): Promise<{ announcements: Announcement[] }> {
	const announcement = validateAnnouncement(body);
	const announcements = (await redis.json.get(rKey.announcements) ?? []) as Announcement[];
	announcements.push(announcement);
	await redis.json.set(rKey.announcements, '$', JSON.parse(JSON.stringify(announcements)));

	await logAnnouncementChange({
		action: 'create_announcement',
		employeeId,
		details: announcement,
		announcementIndex: announcements.length - 1
	});

	return { announcements };
}

export async function updateAnnouncement(
	indexStr: string,
	employeeId: string | number,
	body: unknown
): Promise<{ announcements: Announcement[] }> {
	const index = Number.parseInt(indexStr, 10);
	if (Number.isNaN(index) || index < 0) {
		throw new HqError('Invalid announcement index', 0, 400);
	}

	const announcements = (await redis.json.get(rKey.announcements) ?? []) as Announcement[];
	if (index >= announcements.length) {
		throw new HqError('Announcement not found', 0, 404);
	}

	const updateData = body as Partial<Announcement>;
	// Remove type, vertical, and gameType from updateData as they are fixed values
	const { type, vertical, gameType, ...allowedUpdateData } = updateData;
	const updatedAnnouncement = { 
		...announcements[index], 
		...allowedUpdateData,
		// Always use fixed values for type, vertical, and gameType
		type: 'referral',
		vertical: 'general',
		gameType: 'trivia'
	};
	
	// Validate the updated announcement
	validateAnnouncement(updatedAnnouncement);
	
	announcements[index] = updatedAnnouncement;
	await redis.json.set(rKey.announcements, '$', JSON.parse(JSON.stringify(announcements)));

	await logAnnouncementChange({
		action: 'update_announcement',
		employeeId,
		details: { index, ...updateData },
		announcementIndex: index
	});

	return { announcements };
}

export async function deleteAnnouncement(indexStr: string, employeeId: string | number): Promise<{ announcements: Announcement[] }> {
	const index = Number.parseInt(indexStr, 10);
	if (Number.isNaN(index) || index < 0) {
		throw new HqError('Invalid announcement index', 0, 400);
	}

	const announcements = (await redis.json.get(rKey.announcements) ?? []) as Announcement[];
	if (index >= announcements.length) {
		throw new HqError('Announcement not found', 0, 404);
	}

	const deletedAnnouncement = announcements[index];
	announcements.splice(index, 1);
	await redis.json.set(rKey.announcements, '$', JSON.parse(JSON.stringify(announcements)));

	await logAnnouncementChange({
		action: 'delete_announcement',
		employeeId,
		details: { index, deletedAnnouncement },
		announcementIndex: index
	});

	return { announcements };
}

export async function replaceAnnouncements(employeeId: string | number, body: unknown): Promise<{ announcements: Announcement[] }> {
	if (!Array.isArray(body)) {
		throw new HqError('Request body must be an array', 0, 400);
	}

	const announcements = body.map((item, index) => {
		try {
			return validateAnnouncement(item);
		} catch (error) {
			if (error instanceof HqError) {
				throw new HqError(`Invalid announcement at index ${index}: ${error.error}`, 0, 400);
			}
			throw error;
		}
	});

	await redis.json.set(rKey.announcements, '$', JSON.parse(JSON.stringify(announcements)));

	await logAnnouncementChange({
		action: 'replace_announcements',
		employeeId,
		details: { count: announcements.length }
	});

	return { announcements };
}

export async function reorderAnnouncements(employeeId: string | number, body: unknown): Promise<{ announcements: Announcement[] }> {
	if (!Array.isArray(body)) {
		throw new HqError('Request body must be an array of indices', 0, 400);
	}

	const order = body as unknown[];
	const announcements = (await redis.json.get(rKey.announcements) ?? []) as Announcement[];

	if (order.length !== announcements.length) {
		throw new HqError(`Order array must contain exactly ${announcements.length} indices (one for each announcement)`, 0, 400);
	}

	// Validate all indices are numbers and within valid range
	const seen = new Set<number>();
	const validatedIndices: number[] = [];
	for (let i = 0; i < order.length; i++) {
		const rawIndex = order[i];
		const index = typeof rawIndex === 'number' ? rawIndex : Number.parseInt(String(rawIndex), 10);
		if (Number.isNaN(index) || !Number.isFinite(index) || index < 0 || index >= announcements.length) {
			throw new HqError(`Invalid index at position ${i}: must be a number between 0 and ${announcements.length - 1}`, 0, 400);
		}
		if (seen.has(index)) {
			throw new HqError(`Duplicate index detected: ${index}`, 0, 400);
		}
		seen.add(index);
		validatedIndices.push(index);
	}

	// Reorder announcements based on the provided indices
	const reorderedAnnouncements = validatedIndices.map((index) => {
		return announcements[index];
	});

	await redis.json.set(rKey.announcements, '$', JSON.parse(JSON.stringify(reorderedAnnouncements)));

	await logAnnouncementChange({
		action: 'reorder_announcements',
		employeeId,
		details: { order: validatedIndices.map((idx, pos) => ({ position: pos, originalIndex: idx })) }
	});

	return { announcements: reorderedAnnouncements };
}

