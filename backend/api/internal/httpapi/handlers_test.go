package httpapi

import (
	"errors"
	"net/http"
	"testing"
)

func TestMapServiceErrorStatus(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		name     string
		err      error
		expected int
	}{
		{
			name:     "token invalid maps to unauthorized",
			err:      errors.New("Token无效"),
			expected: http.StatusUnauthorized,
		},
		{
			name:     "credential mismatch maps to unauthorized",
			err:      errors.New("account or password is invalid"),
			expected: http.StatusUnauthorized,
		},
		{
			name:     "not found maps to 404",
			err:      errors.New("instance not found"),
			expected: http.StatusNotFound,
		},
		{
			name:     "invalid params map to 400",
			err:      errors.New("invalid query parameter"),
			expected: http.StatusBadRequest,
		},
		{
			name:     "upstream gateway failure falls back to 502",
			err:      errors.New("upstream 503 service unavailable"),
			expected: http.StatusBadGateway,
		},
	}

	for _, testCase := range testCases {
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			actual := mapServiceErrorStatus(testCase.err)
			if actual != testCase.expected {
				t.Fatalf("expected %d, got %d", testCase.expected, actual)
			}
		})
	}
}
