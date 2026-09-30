import axios from 'axios';
import { Op } from 'sequelize';
import Production from '../../common/database/eventModels/production';
import Audit from '../../common/database/adminModels/audit';
import getDiscordUser from '../utils/getDiscordUser';
import getDiscordAvatar from '../utils/getDiscordAvatar';
import redis from '../../common/redisClient';
import validator from 'validator';
import HqError from '../../common/hqError';
import rKey from '../../common/redisKeys';
import logger from '../../common/logger';
import { generateStreamKey } from '../utils/generateStreamKey';

const DISCORD_EMPLOYEE_GUILD_ID = '972240026425516052';
const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DISCORD_CDN_BASE_URL = 'https://cdn.discordapp.com';

async function loadCategoryOrder(): Promise<string[]> {
	const raw = await redis.get(rKey.employeeCategoryOrder);
	if (!raw) {
		return [];
	}
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
	} catch {
		return [];
	}
}

function normalizeCategoryOrder(order: string[], categories: Record<string, string>): string[] {
	const seen = new Set<string>();
	const normalized: string[] = [];

	order.forEach((slug) => {
		if (typeof slug !== 'string') {
			return;
		}
		const trimmed = slug.trim();
		if (!trimmed || !Object.prototype.hasOwnProperty.call(categories, trimmed) || seen.has(trimmed)) {
			return;
		}
		normalized.push(trimmed);
		seen.add(trimmed);
	});

	Object.keys(categories).forEach((slug) => {
		if (!seen.has(slug)) {
			normalized.push(slug);
			seen.add(slug);
		}
	});

	return normalized;
}

function applyCategoryOrder(categories: Record<string, string>, order: string[]): Record<string, string> {
	if (!order.length) {
		return categories;
	}

	const normalizedOrder = normalizeCategoryOrder(order, categories);
	const orderedEntries = normalizedOrder
		.filter((slug) => Object.prototype.hasOwnProperty.call(categories, slug))
		.map<[string, string]>((slug) => [slug, categories[slug]]);

	return Object.fromEntries(orderedEntries);
}

async function persistCategoryOrder(order: string[]): Promise<void> {
	if (!order.length) {
		await redis.del(rKey.employeeCategoryOrder);
		return;
	}
	await redis.set(rKey.employeeCategoryOrder, JSON.stringify(order));
}

const AUDIT_DESCRIPTION_MAX_LENGTH = 65535;

function truncateForAudit(input: string, maxLength = AUDIT_DESCRIPTION_MAX_LENGTH): string {
	if (input.length <= maxLength) {
		return input;
	}
	return `${input.slice(0, maxLength - 3)}...`;
}

type PermissionNormalizationOptions = {
	allowNegations?: boolean;
	negationNotAllowedMessage?: string;
};

function normalizePermissionsInput(permissionsInput: unknown, options: PermissionNormalizationOptions = {}): string[] {
	const { allowNegations = false, negationNotAllowedMessage = 'permission values cannot start with "!" in this context' } = options;

	if (!Array.isArray(permissionsInput)) {
		throw new HqError('permissions must be an array of strings', 0, 400);
	}

	const normalized: string[] = [];
	const seen = new Set<string>();

	for (const permission of permissionsInput) {
		if (typeof permission !== 'string') {
			throw new HqError('permissions must be an array of strings', 0, 400);
		}
		const trimmed = permission.trim();
		if (!trimmed) {
			throw new HqError('permission names cannot be empty', 0, 400);
		}

		let processed = trimmed;
		if (processed.startsWith('!')) {
			if (!allowNegations) {
				throw new HqError(negationNotAllowedMessage, 0, 400);
			}
			const remainder = processed.slice(1).trim();
			if (!remainder) {
				throw new HqError('permission names cannot be just "!"', 0, 400);
			}
			processed = `!${remainder}`;
		}

		if (!seen.has(processed)) {
			seen.add(processed);
			normalized.push(processed);
		}
	}

	return normalized;
}

async function replaceRedisSet(key: string, values: string[]): Promise<void> {
	const multi = redis.multi();
	multi.del(key);
	if (values.length) {
		multi.sAdd(key, values[0]);
		for (let i = 1; i < values.length; i += 1) {
			multi.sAdd(key, values[i]);
		}
	}
	await multi.exec();
}

function dedupeStrings(values: string[]): string[] {
	const deduped: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		if (typeof value !== 'string') {
			continue;
		}
		const trimmed = value.trim();
		if (!trimmed) {
			continue;
		}
		if (seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		deduped.push(trimmed);
	}
	return deduped;
}

async function resolveCategory(categorySlugInput: unknown): Promise<{ slug: string; name: string; }> {
	const slug = typeof categorySlugInput === 'string' ? categorySlugInput.trim() : '';
	if (!slug) {
		throw new HqError('category slug is required', 0, 400);
	}
	const name = await redis.hGet(rKey.employeeCategories, slug);
	if (!name) {
		throw new HqError('Category not found', 0, 404);
	}
	return { slug, name };
}

export type EmployeePermissionSets = {
	userPerms: string[];
	categoryPerms: string[];
	combined: string[];
};

export async function calculateEmployeePermissionSets(employeeId: string): Promise<EmployeePermissionSets> {
	const employee = await getEmployee(employeeId);
	const redisEmployeeId = employee.userId ?? employeeId;
	const [userPermsRaw, categoryPermsRaw] = await Promise.all([
		redis.sMembers(rKey.employeePermissions(redisEmployeeId)),
		employee.category ? redis.sMembers(rKey.employeeCategoryPermissions(employee.category)) : Promise.resolve([])
	]);

	const userPerms = dedupeStrings(userPermsRaw);
	const categoryPerms = dedupeStrings(categoryPermsRaw);

	const combined = new Set<string>();
	const negations = new Set<string>();

	for (const permission of categoryPerms) {
		combined.add(permission);
	}

	for (const permission of userPerms) {
		if (permission.startsWith('!')) {
			const remainder = permission.slice(1).trim();
			if (remainder) {
				negations.add(remainder);
			}
			continue;
		}
		combined.add(permission);
	}

	for (const negated of negations) {
		combined.delete(negated);
	}

	return {
		userPerms,
		categoryPerms,
		combined: Array.from(combined)
	};
}

export async function getEmployee(employeeId: string) {
	const user = await getDiscordUser(employeeId);
    if (!user) throw new HqError('User not found', 0, 404);

	return user;
}

export async function getAssignments(employeeId: string) {
	const [assignments, gamesWritten, gamesProduced, gamesHosted] = await Promise.all([
		Production.findAll({
			where: {
				game_status: 'unaired',
				cancelled: 0,
				[Op.or]: [{
					hosts: { [Op.substring]: employeeId }
				}, {
					writers: { [Op.substring]: employeeId }
				}, {
					producers: { [Op.substring]: employeeId }
				}]
			}
		}),
		Production.count({
			where: {
				cancelled: 0,
				writers: { [Op.substring]: employeeId }
			}
		}),
		Production.count({
			where: {
				cancelled: 0,
				producers: { [Op.substring]: employeeId }
			}
		}),
		Production.count({
			where: {
				cancelled: 0,
				hosts: { [Op.substring]: employeeId }
			}
		})
	]);
	return {
		assignments,
		gamesWritten,
		gamesProduced,
		gamesHosted
	};
}

export async function getAudit(employeeId: string) {
	const audit = await Audit.findAll({
        where: {
			[Op.or]: [{
                to: employeeId,
                toType: "employee"
            }, {
                from: employeeId
            }]
		},
        order: [ ['date', 'DESC'] ]
    });
	return audit;
}

export async function getEmployeePermissions(employeeId: string): Promise<EmployeePermissionSets> {
	return calculateEmployeePermissionSets(employeeId);
}

export async function setEmployeePermissions(ofEmployeeId: string, requestingEmployeeId: string, permissionsInput: unknown): Promise<EmployeePermissionSets> {
	await getEmployee(ofEmployeeId);

	const uniquePermissions = normalizePermissionsInput(permissionsInput, { allowNegations: true });
	const existingPermissions = dedupeStrings(await redis.sMembers(rKey.employeePermissions(ofEmployeeId)));

	const permissionsToAdd = uniquePermissions.filter((permission) => !existingPermissions.includes(permission));
	const permissionsToRemove = existingPermissions.filter((permission) => !uniquePermissions.includes(permission));

	if (!permissionsToAdd.length && !permissionsToRemove.length) {
		throw new HqError('No changes detected', 0, 406);
	}

	await replaceRedisSet(rKey.employeePermissions(ofEmployeeId), uniquePermissions);

	const descriptionParts: string[] = [];
	if (permissionsToAdd.length) {
		descriptionParts.push(`Granted permissions: ${permissionsToAdd.map((permission) => `\`${permission}\``).join(', ')}`);
	}
	if (permissionsToRemove.length) {
		descriptionParts.push(`Revoked permissions: ${permissionsToRemove.map((permission) => `\`${permission}\``).join(', ')}`);
	}

	await Audit.create({
		to: ofEmployeeId,
		toType: 'employee',
		from: requestingEmployeeId,
		fromType: 'employee',
		action: 'set_employee_permissions',
		description: descriptionParts.join('. ')
	});

	return calculateEmployeePermissionSets(ofEmployeeId);
}

export async function getCategories() {
	const [categories, order] = await Promise.all([
		redis.hGetAll(rKey.employeeCategories),
		loadCategoryOrder()
	]);

	if (!order.length) {
		return categories;
	}

	return applyCategoryOrder(categories, order);
}

export async function getCategoryPermissions(categorySlug: string): Promise<{ permissions: string[]; }> {
	const { slug } = await resolveCategory(categorySlug);
	const permissions = dedupeStrings(await redis.sMembers(rKey.employeeCategoryPermissions(slug)));
	return { permissions };
}

export async function setCategoryPermissions(categorySlug: string, requestingEmployeeId: string, permissionsInput: unknown): Promise<{ permissions: string[]; }> {
	const { slug, name } = await resolveCategory(categorySlug);
	const uniquePermissions = normalizePermissionsInput(permissionsInput, {
		allowNegations: false,
		negationNotAllowedMessage: 'category permissions cannot include exclusions (values starting with "!")'
	});

	const existingPermissions = dedupeStrings(await redis.sMembers(rKey.employeeCategoryPermissions(slug)));

	const permissionsToAdd = uniquePermissions.filter((permission) => !existingPermissions.includes(permission));
	const permissionsToRemove = existingPermissions.filter((permission) => !uniquePermissions.includes(permission));

	if (!permissionsToAdd.length && !permissionsToRemove.length) {
		throw new HqError('No changes detected', 0, 406);
	}

	await replaceRedisSet(rKey.employeeCategoryPermissions(slug), uniquePermissions);

	const descriptionParts: string[] = [];
	if (permissionsToAdd.length) {
		descriptionParts.push(`Granted permissions: ${permissionsToAdd.map((permission) => `\`${permission}\``).join(', ')}`);
	}
	if (permissionsToRemove.length) {
		descriptionParts.push(`Revoked permissions: ${permissionsToRemove.map((permission) => `\`${permission}\``).join(', ')}`);
	}

	await Audit.create({
		to: 'categories',
		toType: 'categories',
		from: requestingEmployeeId,
		fromType: 'employee',
		action: 'set_category_permissions',
		description: truncateForAudit(`Updated permissions for category \`${name}\` (\`${slug}\`). ${descriptionParts.join('. ')}`)
	});

	return { permissions: uniquePermissions };
}

export async function createEmployeeCategory(catName: string, creatingEmployeeId: string) {
	if (!catName) throw new HqError('You must specify a name.', 0, 400);

    function generateSlugNumerical(slug: string, index: number = 1) {
        if (existingCategories[slug + index.toString()]) return generateSlugNumerical(slug, index++);
        return slug + index.toString()
    }

    const existingCategories = await redis.hGetAll(rKey.employeeCategories);
    const strippedSlug = catName.replace(" ", "-").replace(/\W/g, '');
    const slug = existingCategories[strippedSlug] ? generateSlugNumerical(strippedSlug) : strippedSlug;

	const categoriesWithNew = { ...existingCategories, [slug]: catName };
	const currentOrder = await loadCategoryOrder();
	const nextOrder = normalizeCategoryOrder([...currentOrder, slug], categoriesWithNew);

    await redis.hSet(rKey.employeeCategories, slug, catName);
	await persistCategoryOrder(nextOrder);
    await Audit.create({
        to: "categories",
        toType: 'categories',
        from: creatingEmployeeId,
        fromType: 'employee',
        action: 'category_create',
        description: 'Created category `' + catName + '` with slug `' + slug + '`'
    });
    return slug;
}

export async function renameEmployeeCategory(categorySlug: string, nameInput: unknown, requestingEmployeeId: string): Promise<{ slug: string; name: string; }> {
	const { slug, name: currentName } = await resolveCategory(categorySlug);
	const nextName = typeof nameInput === 'string' ? nameInput.trim() : '';

	if (!nextName) {
		throw new HqError('Category name is required', 0, 400);
	}
	if (nextName === currentName) {
		throw new HqError('No changes detected', 0, 406);
	}

	await redis.hSet(rKey.employeeCategories, slug, nextName);

	await Audit.create({
		to: 'categories',
		toType: 'categories',
		from: requestingEmployeeId,
		fromType: 'employee',
		action: 'category_rename',
		description: truncateForAudit(`Renamed category \`${currentName}\` (\`${slug}\`) to \`${nextName}\``)
	});

	return { slug, name: nextName };
}

export async function deleteEmployeeCategory(categorySlug: string, requestingEmployeeId: string): Promise<{ slug: string; name: string; reassignedEmployees: number; fallbackCategory: string | null; }> {
	const { slug, name } = await resolveCategory(categorySlug);
	if (slug === 'other') {
		throw new HqError('The default category cannot be deleted', 0, 400);
	}

	const [categories, currentOrder, employeeIds] = await Promise.all([
		redis.hGetAll(rKey.employeeCategories),
		loadCategoryOrder(),
		redis.sMembers(rKey.employeeIds)
	]);

	const fallbackCategory = Object.prototype.hasOwnProperty.call(categories, 'other') ? 'other' : null;

	const deletePipeline = redis.multi();
	deletePipeline.hDel(rKey.employeeCategories, slug);
	deletePipeline.del(rKey.employeeCategoryPermissions(slug));
	await deletePipeline.exec();

	const nextOrder = currentOrder.filter((orderedSlug) => orderedSlug !== slug);
	await persistCategoryOrder(nextOrder);

	let reassignedEmployees = 0;
	if (employeeIds.length) {
		const readPipeline = redis.multi();
		for (const employeeId of employeeIds) {
			readPipeline.hGet(rKey.employee(employeeId), 'category');
		}
		const readResults = await readPipeline.exec();

		const employeesToUpdate: string[] = [];
		readResults?.forEach((result, index) => {
			let categoryValue: string | null;
			if (typeof result === 'string') {
				categoryValue = result;
			} else if (Buffer.isBuffer(result)) {
				categoryValue = result.toString();
			} else {
				categoryValue = null;
			}
			if (categoryValue === slug) {
				const employeeId = employeeIds[index];
				if (employeeId) {
					employeesToUpdate.push(employeeId);
				}
			}
		});

		if (employeesToUpdate.length) {
			const writePipeline = redis.multi();
			for (const employeeId of employeesToUpdate) {
				if (fallbackCategory) {
					writePipeline.hSet(rKey.employee(employeeId), 'category', fallbackCategory);
				} else {
					writePipeline.hDel(rKey.employee(employeeId), 'category');
				}
			}
			await writePipeline.exec();
			reassignedEmployees = employeesToUpdate.length;
		}
	}

	await Audit.create({
		to: 'categories',
		toType: 'categories',
		from: requestingEmployeeId,
		fromType: 'employee',
		action: 'category_delete',
		description: truncateForAudit([
			`Deleted category \`${name}\` (\`${slug}\`)`,
			reassignedEmployees ? `Reassigned ${reassignedEmployees} employee(s) to \`${fallbackCategory ?? 'none'}\`` : null
		].filter(Boolean).join('. '))
	});

	return { slug, name, reassignedEmployees, fallbackCategory };
}

export async function reorderEmployeeCategories(orderInput: unknown, requestingEmployeeId: string) {
	if (!Array.isArray(orderInput)) {
		throw new HqError('order must be an array of strings', 0, 400);
	}

	const cleanedOrder: string[] = [];
	const seen = new Set<string>();

	for (const value of orderInput) {
		if (typeof value !== 'string') {
			throw new HqError('order must be an array of strings', 0, 400);
		}
		const trimmed = value.trim();
		if (!trimmed) {
			throw new HqError('order cannot include empty strings', 0, 400);
		}
		if (seen.has(trimmed)) {
			throw new HqError(`duplicate slug detected: ${trimmed}`, 0, 400);
		}
		seen.add(trimmed);
		cleanedOrder.push(trimmed);
	}

	const categories = await redis.hGetAll(rKey.employeeCategories);
	const existingSlugs = Object.keys(categories);

	if (!existingSlugs.length) {
		await persistCategoryOrder([]);
		return { order: [] };
	}

	const unknownSlugs = cleanedOrder.filter((slug) => !Object.prototype.hasOwnProperty.call(categories, slug));
	if (unknownSlugs.length) {
		throw new HqError(`order contains unknown category slugs: ${unknownSlugs.join(', ')}`, 0, 400);
	}

	const missingSlugs = existingSlugs.filter((slug) => !seen.has(slug));
	if (missingSlugs.length) {
		throw new HqError(`order must include all category slugs. Missing: ${missingSlugs.join(', ')}`, 0, 400);
	}

	await persistCategoryOrder(cleanedOrder);

	await Audit.create({
		to: 'categories',
        toType: 'categories',
		from: requestingEmployeeId,
		fromType: 'employee',
		action: 'category_reorder',
		description: truncateForAudit(`Set category order to: ${cleanedOrder.map((slug) => `\`${categories[slug] ?? slug}\``).join(', ')}`)
	});

	return { order: cleanedOrder };
}

export async function getEmployees(queryIn: string) {
	// Scan for all employees, then get their details
    const query = queryIn || null;
    const employees = await redis.sMembers(rKey.employeeIds);
    const employeeDetails = await Promise.all(employees.map(getEmployee));
    const queryLower = query ? query.toLowerCase() : null;
    return employeeDetails.filter(employee => 
        !employee?.removed && 
        (queryLower === null || employee?.name.toLowerCase().includes(queryLower))
    );
}

function buildDiscordAvatarUrl(id: string | undefined, memberAvatar: string | null, userAvatar: string | null): string | null {
	if (!id) {
		return null;
	}
	if (memberAvatar) {
		return `${DISCORD_CDN_BASE_URL}/guilds/${DISCORD_EMPLOYEE_GUILD_ID}/users/${id}/avatars/${memberAvatar}.png?size=256`;
	}
	if (userAvatar) {
		return `${DISCORD_CDN_BASE_URL}/avatars/${id}/${userAvatar}.png?size=256`;
	}
	return null;
}

export async function searchDiscordEmployees(searchTermInput: unknown, limitInput: unknown) {
	const parsedSearch = typeof searchTermInput === 'string' ? searchTermInput.trim() : '';

	let limit = 25;
	if (typeof limitInput === 'string' && limitInput.trim()) {
		const parsedLimit = Number.parseInt(limitInput, 10);
		if (!Number.isNaN(parsedLimit)) {
			limit = parsedLimit;
		}
	} else if (typeof limitInput === 'number') {
		limit = limitInput;
	}

	if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
		throw new HqError('limit must be an integer between 1 and 100', 0, 400);
	}

	const botToken = process.env.DISCORD_BOT_TOKEN;
	if (!botToken) {
		throw new HqError('Discord integration is not configured', 0, 500);
	}

	try {
		const endpoint = parsedSearch
			? 'members/search'
			: 'members';
		const params = parsedSearch
			? { query: parsedSearch, limit }
			: { limit };

		const response = await axios.get(`${DISCORD_API_BASE_URL}/guilds/${DISCORD_EMPLOYEE_GUILD_ID}/${endpoint}`, {
			headers: {
				Authorization: `Bot ${botToken}`
			},
			params
		});

		const members = Array.isArray(response.data) ? response.data : [];
		const existingEmployeeIds = await redis.sMembers(rKey.employeeIds);
		const existingEmployeeIdSet = new Set(existingEmployeeIds);

		return members
			.map((member: any) => {
				const user = member?.user ?? {};
				const id: string | undefined = user.id ?? member?.id;
				const displayName = member?.nick ?? user?.global_name ?? user?.username ?? null;
				const avatar = buildDiscordAvatarUrl(id, member?.avatar ?? null, user?.avatar ?? null);
				const discordAt = typeof user?.username === 'string' && user.username.length
					? `@${user.username}`
					: null;
				return {
					id,
					displayName,
					avatar,
					discordAt
				};
			})
			.filter((member: { id?: string; displayName?: string | null; }) => Boolean(
				member.id &&
				member.displayName &&
				!existingEmployeeIdSet.has(member.id)
			));
	} catch (err: any) {
		const status = err?.response?.status;
		if (status === 403 || status === 404) {
			logger.error('Discord API rejected employee search request', {
				status,
				searchTerm: parsedSearch
			});
			throw new HqError('Discord search unavailable', 0, 502);
		}
		logger.error('Failed to search Discord employees', {
			error: err?.message,
			searchTerm: parsedSearch
		});
		throw new HqError('Failed to search Discord employees', 0, 502);
	}
}

export async function updateEmployee(ofEmployeeId: string, requestingEmployeeId: string, body: { [k: string]: unknown; }) {
	const user = await getEmployee(ofEmployeeId);
    if (!user) throw new HqError('User not found', 0, 404);
    
    let changesPrep: (string | number)[] = [];
    let auditPromises = [];
    if (body.name && body.name != user?.name) {
        if (typeof body.name != "string") throw new HqError('Name must be a string', 0, 400);
        changesPrep.push('name', body.name);
        auditPromises.push(() => Audit.create({
            to: ofEmployeeId,
            toType: 'employee',
            from: requestingEmployeeId,
            fromType: 'employee',
            action: 'set_name',
            description: 'Changed name from `' + user.name + '` to `' + body.name + '`'
        }));
    }
    if (body?.email && body.email != user?.email) {
        if (!validator.isEmail(body.email as string)) throw new HqError('Invalid email', 0, 400);
        if (typeof body.email != "string") throw new HqError('Email must be a string', 0, 400);
        changesPrep.push('email', body.email);
        auditPromises.push(() => Audit.create({
            to: ofEmployeeId,
            toType: 'employee',
            from: requestingEmployeeId,
            fromType: 'employee',
            action: 'set_email',
            description: user?.email ? 'Changed email from `' + user.email + '` to `' + body.email + '`' : 'Set email to ' + body.email
        }));
    }
    if (body?.needsRealName != undefined && body.needsRealName != user?.needsRealName) {
        if (typeof body.needsRealName != "boolean") throw new HqError('needsRealName must be a boolean', 0, 400);
        changesPrep.push('needsRealName', body.needsRealName.toString());
        auditPromises.push(() => Audit.create({
            to: ofEmployeeId,
            toType: 'employee',
            from: requestingEmployeeId,
            fromType: 'employee',
            action: 'set_needsRealName',
            description: body.needsRealName ? "Flagged as needing a legal name on file" : "Removed no legal name on file flag"
        }));
    }
    if (body?.category && body.category != user?.category) {
        if (typeof body.category != "string") throw new HqError('Category must be a string', 0, 400);
        changesPrep.push('category', body.category);
        auditPromises.push(() => Audit.create({
            to: ofEmployeeId,
            toType: 'employee',
            from: requestingEmployeeId,
            fromType: 'employee',
            action: 'set_category',
            description: user?.category ? 'Changed category from `' + user.category + '` to `' + body.category + '`' : 'Set category to ' + body.category
        }));
    }
    if (body?.position && body.position != user?.position) {
        if (typeof body.position != "string") throw new HqError('Position must be a string', 0, 400);
        changesPrep.push('position', body.position);
        auditPromises.push(() => Audit.create({
            to: ofEmployeeId,
            toType: 'employee',
            from: requestingEmployeeId,
            fromType: 'employee',
            action: 'set_position',
            description: user?.email ? 'Changed position from `' + user.position + '` to `' + body.position + '`' : 'Set position to ' + body.position
        }));
    }
    if (body?.pinned !== undefined && body.pinned !== user?.pinned) {
        if (typeof body.pinned != "boolean") throw new HqError('pinned must be a boolean', 0, 400);
        changesPrep.push('pinned', body.pinned ? 'true' : 'false');
        auditPromises.push(() => Audit.create({
            to: ofEmployeeId,
            toType: 'employee',
            from: requestingEmployeeId,
            fromType: 'employee',
            action: 'set_pinned',
            description: body.pinned ? 'Pinned employee profile' : 'Unpinned employee profile'
        }));
    }
    if (body?.hired && body.hired != user?.hired) {
        if (typeof body.hired != "string") throw new HqError('Hired must be a string', 0, 400);
        changesPrep.push('hired', body.hired);
        auditPromises.push(() => Audit.create({
            to: ofEmployeeId,
            toType: 'employee',
            from: requestingEmployeeId,
            fromType: 'employee',
            action: 'set_hired',
            description: user?.hired ? 'Changed hired date from `' + user.hired + '` to `' + body.hired + '`' : 'Set hired date to ' + body.hired
        }));
    }
    
    await Promise.all(auditPromises.map((func) => func()));
    if (changesPrep.length != 0) {
        return await redis.hSet(rKey.employee(ofEmployeeId), changesPrep);
    } else {
        throw new HqError('406 Not Acceptable', 0, 406);
    }
}

export async function createEmployee(employeeId: string, body: { [k: string]: unknown; }) {
	// Check if employee already exists
	const existingEmployee = await redis.exists(rKey.employee(body.userId as string));
    if (existingEmployee) throw new HqError('Employee already exists.', 0, 409);
    
    // Validate email if provided
    if (body.email && typeof body.email === 'string' && !validator.isEmail(body.email)) {
        throw new HqError('Invalid email', 0, 400);
    }
    
    // Fetch Discord avatar
    const avatarId = await getDiscordAvatar(body.userId as string);
    
    // Prepare employee data
    const employeeData: { [key: string]: string } = {
        userId: body.userId as string,
        name: body.name as string,
        position: (body.position as string) ?? 'Employee',
        category: (body.category as string) ?? 'other',
		streamKey: generateStreamKey(),
        verified: 'false',
        mfa_enabled: 'false'
    };
    
    // Add avatar if available
    if (avatarId) {
        employeeData.avatarId = avatarId;
    }
    
    if (body.email) {
        employeeData.email = body.email as string;
    }
    
    if (body.hired !== undefined && body.hired !== null) {
        if (typeof body.hired !== 'string') {
            throw new HqError('Hired must be a string', 0, 400);
        }
        employeeData.hired = body.hired;
    } else {
        employeeData.hired = new Date().toISOString();
    }
    
    if (body.needsRealName !== undefined) {
        employeeData.needsRealName = (body.needsRealName as boolean).toString();
    }
    
    // Create employee in Redis
    await redis.multi()
        .hSet(rKey.employee(body.userId as string), Object.entries(employeeData))
        .sAdd(rKey.employeeIds, body.userId as string)
        .del(rKey.employeeLastOnline(body.userId as string))
        .exec();
    
    // Create audit log
    await Audit.create({
        to: body.userId as string,
        toType: 'employee',
        from: employeeId,
        fromType: 'employee',
        action: 'create_employee',
        description: `Created employee: ${body.name}`
    });
    
    // Return the created employee
    return await getEmployee(body.userId as string);
}

export async function refreshAllEmployeeAvatars() {
    const employeeIds = await redis.sMembers(rKey.employeeIds);
    const results = {
        total: employeeIds.length,
        updated: 0,
        failed: 0,
        errors: [] as string[]
    };
    
    // Process in batches to avoid overwhelming the Discord API
    const batchSize = 10;
    for (let i = 0; i < employeeIds.length; i += batchSize) {
        const batch = employeeIds.slice(i, i + batchSize);
        await Promise.all(batch.map(async (employeeId) => {
            try {
                const user = await getDiscordUser(employeeId);
                if (!user || !user.userId) {
                    results.failed++;
                    results.errors.push(`Employee ${employeeId}: User data not found`);
                    return;
                }
                
                const botToken = process.env.DISCORD_BOT_TOKEN;
                if (!botToken) {
                    results.failed++;
                    results.errors.push(`Employee ${employeeId}: DISCORD_BOT_TOKEN not configured`);
                    return;
                }
                
                let newAvatarId: string | null = null;
                let apiCallSucceeded = false;
                
                try {
                    const response = await axios.get(`https://discord.com/api/v10/users/${user.userId}`, {
                        headers: {
                            'Authorization': `Bot ${botToken}`
                        }
                    });
                    apiCallSucceeded = true;
                    newAvatarId = response.data.avatar || null;
                } catch (err: any) {
                    if (err.response?.status === 404) {
                        apiCallSucceeded = true;
                        newAvatarId = null;
                    } else {
                        apiCallSucceeded = false;
                        logger.warn(`Failed to fetch Discord avatar for employee ${employeeId}: ${err.message || 'Unknown error'}`);
                    }
                }
                
                if (apiCallSucceeded) {
                    if (newAvatarId) {
                        await redis.hSet(rKey.employee(employeeId), 'avatarId', newAvatarId);
                        if (user.userId !== employeeId) {
                            await redis.hSet(rKey.employee(user.userId), 'avatarId', newAvatarId);
                        }
                    } else {
                        await redis.hDel(rKey.employee(employeeId), 'avatarId');
                        if (user.userId !== employeeId) {
                            await redis.hDel(rKey.employee(user.userId), 'avatarId');
                        }
                    }
                    results.updated++;
                } else {
                    results.failed++;
                    results.errors.push(`Employee ${employeeId}: API call failed, preserving existing avatarId`);
                }
            } catch (err: any) {
                results.failed++;
                results.errors.push(`Employee ${employeeId}: ${err.message || 'Unknown error'}`);
            }
        }));
        
        // Small delay between batches to respect rate limits
        if (i + batchSize < employeeIds.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    return results;
}

export async function removeEmployee(ofEmployeeId: string, requestingEmployeeId: string, reason: unknown) {
	const user = await getEmployee(ofEmployeeId);
    if (!user) throw new HqError('User not found', 0, 404);
    if (!reason || typeof reason !== 'string') throw new HqError('You must declare a reason.', 0, 400);
    if (!["resigned", "dismissed", "deceased", "contractEnded", "other"].includes(reason)) throw new HqError('Invalid reason. Must be one of: resigned,dismissed,deceased,contractEnded,other', 0, 400);

    let removalReasons: { [key: string]: string } = {
        "resigned": "Employee resigned.",
        "dismissed": "Employee was dismissed.",
        "deceased": "Employee deceased.",
        "contractEnded": "Employee contract ended.",
        "other": "No reason specified."
    };

    const removedDate = new Date().toISOString();
    await redis
        .multi()
        .hSet(rKey.employee(ofEmployeeId), ['removed', removedDate, 'removedWhy', reason])
        .del(rKey.employeePermissions(ofEmployeeId))
        .exec();
    await Audit.create({
        to: ofEmployeeId,
        toType: 'account',
        from: requestingEmployeeId,
        fromType: 'employee',
        action: 'remove_employee',
        description: 'Removed employee. ' + (removalReasons[reason] ?? "") + ' All permissions revoked.'
    });
    return user;
}

function buildEmployeeAvatarUrl(userId: string | null | undefined, avatarId: string | null | undefined): string | null {
	if (!userId || !avatarId) {
		return null;
	}
	return `${DISCORD_CDN_BASE_URL}/avatars/${userId}/${avatarId}.png?size=256`;
}

export async function getEmployeesBasic() {
	const employeeIds = await redis.sMembers(rKey.employeeIds);
	const employees = await Promise.all(
		employeeIds.map(async (employeeId) => {
			const [name, userId, avatarId] = await redis.hmGet(
				rKey.employee(employeeId),
				['name', 'userId', 'avatarId']
			);
			
			const discordUserId = userId || employeeId;
			const avatarUrl = buildEmployeeAvatarUrl(discordUserId, avatarId || null);
			
			return {
				id: employeeId,
				username: name || null,
				avatar: avatarUrl
			};
		})
	);
	
	return employees;
}

export async function getEmployeeStreamCredentials(employeeId: string, requestingEmployeeId: string) {
	const employee = await getEmployee(employeeId);
	if (!employee) throw new HqError('Employee not found', 0, 404);

	// Check if requesting employee is viewing their own credentials or has passwords.view permission
	// An employee can view their own credentials if the requestingEmployeeId matches either the employeeId or the employee's userId (Discord ID)
	const isSelf = String(employeeId) === String(requestingEmployeeId) || 
	               (employee.userId && String(employee.userId) === String(requestingEmployeeId));
	if (!isSelf) {
		const permissions = await calculateEmployeePermissionSets(requestingEmployeeId);
		if (!permissions.combined.includes('passwords.view')) {
			throw new HqError('Forbidden. Requires permission: passwords.view', 102, 403);
		}
	}

	const streamKey = await redis.hGet(
		rKey.employee(employeeId),
		'streamKey'
	);

	return {
		streamKey: streamKey ?? null
	};
}
