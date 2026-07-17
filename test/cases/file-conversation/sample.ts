/**
 * Sample TypeScript Module
 * 
 * This file demonstrates various TypeScript constructs for testing
 * the AI's ability to understand and explain code.
 */

// Interface definition
interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  role: 'admin' | 'user' | 'guest';
}

// Type alias
type UserList = User[];

// Enum
enum OrderStatus {
  Pending = 'pending',
  Processing = 'processing',
  Shipped = 'shipped',
  Delivered = 'delivered',
  Cancelled = 'cancelled',
}

// Class with generics
class Repository<T extends { id: string }> {
  private items: Map<string, T> = new Map();

  add(item: T): void {
    this.items.set(item.id, item);
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  getAll(): T[] {
    return Array.from(this.items.values());
  }

  delete(id: string): boolean {
    return this.items.delete(id);
  }

  count(): number {
    return this.items.size;
  }
}

// Async function with error handling
async function fetchUserData(userId: string): Promise<User> {
  try {
    const response = await fetch(`/api/users/${userId}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data as User;
  } catch (error) {
    console.error('Failed to fetch user:', error);
    throw error;
  }
}

// Higher-order function
function createLogger(prefix: string) {
  return (message: string) => {
    console.log(`[${prefix}] ${new Date().toISOString()}: ${message}`);
  };
}

// Utility functions
function calculateTotalPrice(items: { price: number; quantity: number }[]): number {
  return items.reduce((total, item) => total + item.price * item.quantity, 0);
}

function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount);
}

// Export
export {
  User,
  UserList,
  OrderStatus,
  Repository,
  fetchUserData,
  createLogger,
  calculateTotalPrice,
  formatCurrency,
};
