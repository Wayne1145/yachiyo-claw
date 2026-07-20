// Re-export MCP types from shared layer for backward compatibility
export type {
  MCPMobileServerConfig,
  MCPMobileServerConfigValue,
  MCPMobileValidationIssue,
  MCPSecretKind,
  MCPOAuthConfig,
  MCPSecretRef,
  MCPSecretRefValue,
  MCPServerManifest,
  MCPServerManifestValue,
  MCPServerConfig,
  MCPTransportConfig,
  MCPServerStatus,
} from '../../../shared/types/mcp'

export {
  assertMobileMCPServerConfig,
  MCPMobileServerConfigSchema,
  MCPOAuthConfigSchema,
  MCPSecretRefSchema,
  MCPServerManifestSchema,
  validateMobileMCPServerConfig,
} from '../../../shared/types/mcp'
