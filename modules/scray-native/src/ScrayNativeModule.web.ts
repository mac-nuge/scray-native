import { registerWebModule, NativeModule } from 'expo';

// ScrayNativeModule is not available on the web platform.
class ScrayNativeModule extends NativeModule<{}> {}

export default registerWebModule(ScrayNativeModule, 'ScrayNativeModule');
