// describeError names what went wrong, and why, where an error has a cause: a
// request that fails before the server answers says only that it failed, and
// leaves the reason, such as a connection that was refused or a host that is
// not known, to its cause.
export const describeError = (error: unknown): string => {
	if (!(error instanceof Error)) {
		return String(error);
	}

	return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
};
