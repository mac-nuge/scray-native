import { requireNativeView } from 'expo';
import * as React from 'react';

import { ScrayNativeViewProps } from './ScrayNative.types';

const NativeView: React.ComponentType<ScrayNativeViewProps> = requireNativeView('ScrayNative');

export default function ScrayNativeView(props: ScrayNativeViewProps) {
  return <NativeView {...props} />;
}
