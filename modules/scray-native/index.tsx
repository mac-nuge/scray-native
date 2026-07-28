import { requireNativeView } from 'expo';
import { requireNativeModule } from 'expo-modules-core';

const NativeView = requireNativeView('ScrayWebView');
const NativeModule = requireNativeModule('ScrayWebView');

export function ScrayWebView(props: { source: string; style?: any }) {
  return <NativeView {...props} />;
}

export const pickFolder = () => NativeModule.pickFolder();
export const listVideoFiles = () => NativeModule.listVideoFiles();
export const debugBundle = () => NativeModule.debugBundle();