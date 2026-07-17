# API Documentation

This document provides comprehensive documentation for the Sample API.

## Authentication

All API requests require authentication using Bearer tokens.

```http
Authorization: Bearer <your-api-token>
```

## Endpoints

### Users

#### GET /api/users

Retrieves a list of all users.

**Query Parameters:**
- `page` (optional): Page number for pagination (default: 1)
- `limit` (optional): Number of items per page (default: 20)
- `role` (optional): Filter by user role

**Response:**
```json
{
  "users": [...],
  "total": 100,
  "page": 1,
  "limit": 20
}
```

#### GET /api/users/:id

Retrieves a specific user by ID.

**Path Parameters:**
- `id`: The unique user identifier

**Response:**
```json
{
  "id": "user-001",
  "name": "Alice Johnson",
  "email": "alice@example.com",
  "role": "admin",
  "createdAt": "2024-01-15T10:30:00Z"
}
```

#### POST /api/users

Creates a new user.

**Request Body:**
```json
{
  "name": "New User",
  "email": "newuser@example.com",
  "password": "securepassword123",
  "role": "user"
}
```

### Products

#### GET /api/products

Retrieves a list of all products.

**Query Parameters:**
- `category` (optional): Filter by category
- `minPrice` (optional): Minimum price filter
- `maxPrice` (optional): Maximum price filter
- `inStock` (optional): Filter for in-stock items only

#### POST /api/products

Creates a new product.

**Request Body:**
```json
{
  "name": "New Product",
  "description": "Product description",
  "price": 29.99,
  "category": "electronics",
  "stock": 100
}
```

### Orders

#### GET /api/orders

Retrieves all orders for the authenticated user.

#### POST /api/orders

Creates a new order.

**Request Body:**
```json
{
  "items": [
    { "productId": "prod-001", "quantity": 2 },
    { "productId": "prod-002", "quantity": 1 }
  ],
  "shippingAddress": {
    "street": "123 Main St",
    "city": "Anytown",
    "state": "CA",
    "zipCode": "12345"
  }
}
```

## Error Handling

All errors follow this format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {}
  }
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid authentication |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `VALIDATION_ERROR` | 400 | Invalid request parameters |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |

## Rate Limiting

API requests are limited to:
- 100 requests per minute for authenticated users
- 20 requests per minute for unauthenticated requests

Rate limit headers:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1699999999
```

## Webhooks

Configure webhooks to receive real-time notifications.

### Events

- `user.created`: New user registered
- `order.placed`: New order created
- `order.shipped`: Order has shipped
- `payment.completed`: Payment processed

### Webhook Payload

```json
{
  "event": "order.placed",
  "timestamp": "2024-12-01T10:30:00Z",
  "data": {
    "orderId": "order-123",
    "userId": "user-001",
    "total": 129.98
  }
}
```

## Versioning

The API uses URL versioning. Current version: v1

Future versions will be accessible at `/api/v2/...`

## Support

For API support, contact:
- Email: api-support@example.com
- Documentation: https://docs.example.com
- Status Page: https://status.example.com
