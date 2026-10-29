package com.tandy03.fino;

/** Separate authority: only cache/portfolio-share is reachable, never JSON/account storage. */
public final class PortfolioShareFileProvider extends androidx.core.content.FileProvider {}
