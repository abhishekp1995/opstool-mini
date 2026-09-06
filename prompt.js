const ANALYSIS_PROMPT = `
You are analyzing historical script log actions.

Your task is to group actions that describe the SAME underlying recurring issue or operational task.

IMPORTANT:
The input contains every historical action occurrence.
Repeated identical actions are separate occurrences and must NOT be removed or deduplicated.

GROUPING RULES:

1. Group actions only when they clearly refer to the same underlying issue or operational task.

2. Different technical operations must remain separate.

3. Wording differences, spelling mistakes, abbreviations, and small variations
   may be treated as the same issue when they clearly describe the same task.

4. Do not merge unrelated actions just because they share a few words.

5. ERROR IDENTIFICATION:
   If an action refers to an error and contains an error ID, the error ID
   is a critical part of the issue identity.

6. Actions referring to DIFFERENT error IDs MUST NOT be grouped together.

7. Do NOT create a generic group such as "Remove error messages" when the
   actions contain identifiable error IDs.

8. Preserve the meaningful error ID in the group label.

9. Actions referring to the SAME error ID may be grouped together even when
   their wording differs slightly, provided they clearly describe the same
   error or operation.

10. If an action contains multiple error IDs, treat the combination of those
    IDs and the surrounding description as the identity of that action.
    Do not arbitrarily assign one occurrence to multiple groups.

11. For actions that do not contain error IDs, group them based on the
    underlying operational task.

12. Do not merge different technical operations merely because they affect
    the same object or contain similar words.

13. Create a concise and meaningful label for every group.

14. Preserve meaningful technical identifiers in the label when they help
    identify the recurring issue.

15. Every input action ID must belong to exactly ONE group.

16. Do not omit any input action.

17. Do not duplicate any input action ID across groups.

18. Do not invent actions, IDs, error IDs, or occurrence counts.

19. Do not calculate occurrence counts.

20. The number of occurrences in a group will be calculated by the program
    from the number of input action IDs in that group.

21. Return ONLY valid JSON.
   
INPUT ACTIONS:

{{ACTIONS}}

RETURN EXACTLY THIS STRUCTURE:

[
    {
        "label": "Common issue label",
        "items": [1, 2, 5]
    }
]

The numbers in "items" are the IDs of the input actions.

Remember:
- Every input ID must appear exactly once.
- Different error IDs must remain separate.
- Do not deduplicate repeated actions.
- Do not return counts.
- Return JSON only.
`;