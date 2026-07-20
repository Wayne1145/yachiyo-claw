import {
  ModelCatalogController,
  type ModelCatalogControllerOptions,
} from '@shared/models/model-catalog'
import { createNativeModelDownloadSink } from '@/platform/native/yachiyo_model_manager'

/**
 * Mobile catalog facade: metadata stays in the shared adapters while lifecycle
 * commands are handed to the native WorkManager bridge by identifier only.
 */
export function createMobileModelCatalogController(options: ModelCatalogControllerOptions = {}): ModelCatalogController {
  return new ModelCatalogController({
    ...options,
    sink: options.sink || createNativeModelDownloadSink(),
  })
}
