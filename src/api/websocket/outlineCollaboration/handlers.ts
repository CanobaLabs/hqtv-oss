import { OutlineEditOperation, OutlineItem } from './types';
import HqError from '../../../common/hqError';

export interface EditResult {
    outline: OutlineItem[];
    affectedItemId?: number;
}

export function handleOutlineEdit(
    currentOutline: OutlineItem[],
    operation: OutlineEditOperation,
    employeeId: string,
    userName: string
): EditResult {
    const now = new Date();
    let newOutline = [...currentOutline];
    let affectedItemId: number | undefined;
    
    // Create Map for O(1) lookups instead of O(n) findIndex
    const itemIndexMap = new Map<number, number>();
    newOutline.forEach((item, index) => {
        itemIndexMap.set(item.id, index);
    });
    
    switch (operation.type) {
        case 'add': {
            const { item, index } = operation;
            const newItem: OutlineItem = {
                ...item,
                id: item.id || generateItemId(newOutline),
                created: now,
                createdBy: employeeId,
                updated: now,
                updatedBy: employeeId
            };
            
            const insertIndex = Math.max(0, Math.min(index, newOutline.length));
            newOutline.splice(insertIndex, 0, newItem);
            // Rebuild index map after insertion
            itemIndexMap.clear();
            newOutline.forEach((item, idx) => {
                itemIndexMap.set(item.id, idx);
            });
            affectedItemId = newItem.id;
            break;
        }
        
        case 'update': {
            const { itemId, changes } = operation;
            const itemIndex = itemIndexMap.get(itemId);
            
            if (itemIndex === undefined) {
                throw new HqError(`Item with id ${itemId} not found`, 0, 404);
            }
            
            const updatedItem = {
                ...newOutline[itemIndex],
                ...changes,
                id: itemId,
                updated: now,
                updatedBy: employeeId
            };
            
            newOutline[itemIndex] = updatedItem;
            affectedItemId = itemId;
            break;
        }
        
        case 'updateField': {
            const { itemId, field, value } = operation;
            const itemIndex = itemIndexMap.get(itemId);
            
            if (itemIndex === undefined) {
                throw new HqError(`Item with id ${itemId} not found`, 0, 404);
            }
            
            if (['id', 'created', 'createdBy', 'updated', 'updatedBy'].includes(field)) {
                throw new HqError(`Cannot update protected field: ${field}`, 0, 400);
            }
            
            const updatedItem = {
                ...newOutline[itemIndex],
                [field]: value,
                updated: now,
                updatedBy: employeeId
            };
            
            newOutline[itemIndex] = updatedItem;
            affectedItemId = itemId;
            break;
        }
        
        case 'delete': {
            const { itemId } = operation;
            const itemIndex = itemIndexMap.get(itemId);
            
            if (itemIndex === undefined) {
                throw new HqError(`Item with id ${itemId} not found`, 0, 404);
            }
            
            newOutline.splice(itemIndex, 1);
            itemIndexMap.delete(itemId);
            // Rebuild index map after deletion
            itemIndexMap.clear();
            newOutline.forEach((item, idx) => {
                itemIndexMap.set(item.id, idx);
            });
            affectedItemId = itemId;
            break;
        }
        
        case 'reorder': {
            const { itemId, newIndex } = operation;
            const itemIndex = itemIndexMap.get(itemId);
            
            if (itemIndex === undefined) {
                throw new HqError(`Item with id ${itemId} not found`, 0, 404);
            }
            
            const item = newOutline.splice(itemIndex, 1)[0];
            const insertIndex = Math.max(0, Math.min(newIndex, newOutline.length));
            newOutline.splice(insertIndex, 0, item);
            // Rebuild index map after reorder
            itemIndexMap.clear();
            newOutline.forEach((item, idx) => {
                itemIndexMap.set(item.id, idx);
            });
            affectedItemId = itemId;
            break;
        }
        
        default:
            throw new HqError(`Unknown operation type: ${(operation as { type: string }).type}`, 0, 400);
    }
    
    return {
        outline: newOutline,
        affectedItemId
    };
}

function generateItemId(outline: OutlineItem[]): number {
    if (outline.length === 0) return 1;
    const maxId = Math.max(...outline.map(item => item.id || 0));
    return maxId + 1;
}

