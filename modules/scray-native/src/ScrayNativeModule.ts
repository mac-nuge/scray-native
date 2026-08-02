import { NativeModule, requireNativeModule } from 'expo';

declare class ScrayNativeModule extends NativeModule<{}> {
  pickFolder(): void;
  listVideoFiles(): string[];
  debugBundle(): { resourcePath: string; rootContents: string[]; webFolderContents: string[] };
}

export default requireNativeModule<ScrayNativeModule>('ScrayNative');