package com.pstu.backend.exception;

/**
 * Raised when a requested state transition is not part of the lifecycle.
 *
 * <p>Mapped to HTTP 409 by {@code GlobalExceptionHandler} rather than 400: the
 * request is well-formed, it simply conflicts with the state the aggregate is in
 * (double-dispatching a resolved incident, completing a cancelled allocation).
 * Clients can tell the two apart and refresh instead of retrying the same body.
 */
public class InvalidStateTransitionException extends RuntimeException {

    private final String aggregate;
    private final String aggregateId;
    private final String from;
    private final String to;
    private final String hint;

    public InvalidStateTransitionException(String aggregate, String aggregateId,
                                           Object from, Object to, String hint) {
        super("%s %s cannot move from %s to %s%s".formatted(
                aggregate, aggregateId, from, to, hint == null ? "" : ". " + hint));
        this.aggregate = aggregate;
        this.aggregateId = aggregateId;
        this.from = String.valueOf(from);
        this.to = String.valueOf(to);
        this.hint = hint;
    }

    public String aggregate() {
        return aggregate;
    }

    public String aggregateId() {
        return aggregateId;
    }

    public String from() {
        return from;
    }

    public String to() {
        return to;
    }

    public String hint() {
        return hint;
    }
}
