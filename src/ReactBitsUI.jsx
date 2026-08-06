import { forwardRef } from 'react';

export const BitsButton = forwardRef(function BitsButton(
  {
    className = '',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      className={className || undefined}
      {...props}
    />
  );
});

export const BitsSurface = forwardRef(function BitsSurface(
  {
    as: Component = 'div',
    className = '',
    ...props
  },
  ref,
) {
  return (
    <Component
      ref={ref}
      className={className || undefined}
      {...props}
    />
  );
});
