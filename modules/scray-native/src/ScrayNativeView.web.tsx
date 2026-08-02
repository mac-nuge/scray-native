import { ScrayNativeViewProps } from './ScrayNative.types';

// ScrayNativeView is not available on the web platform.
export default function ScrayNativeView(_props: ScrayNativeViewProps) {
  throw new Error('ScrayNativeView is not available on the web platform.');
}
