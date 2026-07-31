import React, { useState } from 'react';

type Props = {
  as?: any;
  style?: React.CSSProperties;
  hover?: React.CSSProperties;
  active?: React.CSSProperties;
  focus?: React.CSSProperties;
  children?: React.ReactNode;
  [key: string]: any;
};

/**
 * Inline-style element with interaction states. The design uses inline styles
 * throughout, so :hover / :active / :focus are tracked in state and merged
 * over the base style in that order.
 */
export default function Hoverable({ as: Tag = 'div', style, hover, active, focus, children, ...rest }: Props) {
  const [isHover, setHover] = useState(false);
  const [isActive, setActive] = useState(false);
  const [isFocus, setFocus] = useState(false);

  const merged: React.CSSProperties = {
    ...style,
    ...(isHover && hover ? hover : null),
    ...(isFocus && focus ? focus : null),
    ...(isActive && active ? active : null),
  };

  const chain = (own: (e: any) => void, theirs?: (e: any) => void) => (e: any) => { own(e); theirs?.(e); };

  return (
    <Tag
      {...rest}
      style={merged}
      onMouseEnter={chain(() => setHover(true), rest.onMouseEnter)}
      onMouseLeave={chain(() => { setHover(false); setActive(false); }, rest.onMouseLeave)}
      onMouseDown={chain(() => setActive(true), rest.onMouseDown)}
      onMouseUp={chain(() => setActive(false), rest.onMouseUp)}
      onFocus={chain(() => setFocus(true), rest.onFocus)}
      onBlur={chain(() => setFocus(false), rest.onBlur)}
    >
      {children}
    </Tag>
  );
}
