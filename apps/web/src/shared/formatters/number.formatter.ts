// Number Formatting Utilities - Single Source of Truth

interface FormatCurrencyOptions {
  /** Number of decimal places */
  decimals?: number;
  /** Use compact notation (1.2M, 500K) */
  compact?: boolean;
  /** Currency prefix (default: '$') */
  prefix?: string;
  /** Suffix to append (e.g., '/day') */
  suffix?: string;
  /** Show sign for positive numbers */
  showPositiveSign?: boolean;
}

/**
 * Format currency values with smart compact notation
 * @example formatCurrency(1234567) → "$1.23M"
 * @example formatCurrency(1234) → "$1.23K"
 * @example formatCurrency(123.456, { decimals: 2 }) → "$123.46"
 */
export function formatCurrency(
  value: number | null | undefined,
  options: FormatCurrencyOptions = {}
): string {
  const {
    decimals,
    compact = true,
    prefix = '$',
    suffix = '',
    showPositiveSign = false,
  } = options;

  // Handle invalid numbers (including null/undefined)
  if (value === null || value === undefined || !isFinite(value) || isNaN(value)) {
    return `${prefix}0${suffix}`;
  }

  const absValue = Math.abs(value);
  const sign = value < 0 ? '-' : (showPositiveSign && value > 0 ? '+' : '');

  if (compact) {
    if (absValue >= 1_000_000_000) {
      const formatted = (absValue / 1_000_000_000).toFixed(decimals ?? 2);
      return `${sign}${prefix}${formatted}B${suffix}`;
    }
    if (absValue >= 1_000_000) {
      const formatted = (absValue / 1_000_000).toFixed(decimals ?? 2);
      return `${sign}${prefix}${formatted}M${suffix}`;
    }
    if (absValue >= 1_000) {
      const formatted = (absValue / 1_000).toFixed(decimals ?? 1);
      return `${sign}${prefix}${formatted}K${suffix}`;
    }
  }

  const formatted = absValue.toFixed(decimals ?? 2);
  return `${sign}${prefix}${formatted}${suffix}`;
}

/**
 * Format percentage values
 * @example formatPercent(42.567) → "42.57%"
 * @example formatPercent(1234.5) → "1.2K%"
 */
export function formatPercent(value: number, decimals: number = 2): string {
  if (!isFinite(value) || isNaN(value)) {
    return '0%';
  }

  const absValue = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  // For very large percentages, use compact notation
  if (absValue >= 10000) {
    return `${sign}${(absValue / 1000).toFixed(1)}K%`;
  }
  if (absValue >= 1000) {
    return `${sign}${(absValue / 1000).toFixed(2)}K%`;
  }

  return `${sign}${absValue.toFixed(decimals)}%`;
}

/**
 * Format price with adaptive precision
 * @example formatPrice(1234.56) → "$1,234.56"
 * @example formatPrice(0.00001234) → "$0.00001234"
 * @example formatPrice(0.000000001) → "$1.00e-9"
 */
export function formatPrice(value: number, prefix: string = '$'): string {
  if (!isFinite(value) || isNaN(value)) {
    return `${prefix}0`;
  }

  const absValue = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  // Very small numbers: scientific notation
  if (absValue > 0 && absValue < 0.000001) {
    return `${sign}${prefix}${absValue.toExponential(2)}`;
  }

  // Small numbers: show more decimals
  if (absValue < 0.01) {
    return `${sign}${prefix}${absValue.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')}`;
  }

  if (absValue < 1) {
    return `${sign}${prefix}${absValue.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`;
  }

  if (absValue < 10) {
    return `${sign}${prefix}${absValue.toFixed(4)}`;
  }

  if (absValue < 1000) {
    return `${sign}${prefix}${absValue.toFixed(2)}`;
  }

  // Large numbers: use locale formatting
  return `${sign}${prefix}${absValue.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

/**
 * Format APR/APY with appropriate notation
 * @example formatApr(42.5) → "42.5%"
 * @example formatApr(1500) → "1.5K%"
 */
export function formatApr(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  if (!isFinite(value) || isNaN(value) || value === 0) {
    return '0%';
  }

  if (value >= 10000) {
    return `${(value / 1000).toFixed(1)}K%`;
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}K%`;
  }

  if (value >= 100) {
    return `${value.toFixed(0)}%`;
  }

  return `${value.toFixed(1)}%`;
}

/**
 * Format TVL value
 * @example formatTvl(8200000) → "$8.2M"
 * @example formatTvl(500000) → "$500K"
 */
export function formatTvl(value: number): string {
  return formatCurrency(value, { compact: true, decimals: 1 });
}

/**
 * Format emission value
 * @example formatEmission(1500) → "$1.5K/day"
 * @example formatEmission(500) → "$500/day"
 */
export function formatEmission(value: number): string {
  if (!isFinite(value) || isNaN(value) || value === 0) {
    return '$0/day';
  }

  if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}K/day`;
  }

  return `$${value.toFixed(0)}/day`;
}

/**
 * Format token amount with adaptive precision
 * @example formatTokenAmount(1.23456789) → "1.2346"
 * @example formatTokenAmount(0.00001234) → "0.00001234"
 */
export function formatTokenAmount(value: number, symbol: string | null = null): string {
  if (!isFinite(value) || isNaN(value)) {
    return symbol ? `0 ${symbol}` : '0';
  }

  const absValue = Math.abs(value);
  let formatted: string;

  if (absValue === 0) {
    formatted = '0';
  } else if (absValue < 0.0001) {
    formatted = absValue.toExponential(2);
  } else if (absValue < 1) {
    formatted = absValue.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  } else if (absValue < 1000) {
    formatted = absValue.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  } else {
    formatted = absValue.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }

  return symbol ? `${formatted} ${symbol}` : formatted;
}

