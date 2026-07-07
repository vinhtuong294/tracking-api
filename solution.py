def max_score(nums):
    """
    Returns the maximum score Alice can achieve in the optimal game play.
    
    Args:
        nums (List[int]): The sequence of numbers.
        
    Returns:
        int: The maximum score Alice can get.
    """
    n = len(nums)
    if n == 0:
        return 0
    
    # dp for subarrays of length 1
    prev = nums[:]
    
    # iterate over lengths from 2 to n
    for length in range(2, n + 1):
        curr = [0] * (n - length + 1)
        for i in range(n - length + 1):
            j = i + length - 1
            # choose left end or right end
            take_left = nums[i] - prev[i + 1]
            take_right = nums[j] - prev[i]
            curr[i] = max(take_left, take_right)
        prev = curr
    
    total = sum(nums)
    diff = prev[0]
    # Alice's score = (total + diff) // 2
    return (total + diff) // 2


# Example usage and test cases
if __name__ == "__main__":
    # Test case 1
    nums1 = [1, 2, 3]
    print(f"max_score({nums1}) = {max_score(nums1)}")  # Expected: 4
    
    # Test case 2
    nums2 = [1, 5, 2]
    print(f"max_score({nums2}) = {max_score(nums2)}")  # Expected: 3
    
    # Test case 3
    nums3 = [8, 15, 3, 7]
    print(f"max_score({nums3}) = {max_score(nums3)}")  # Expected: 22
    
    # Test case 4: single element
    nums4 = [10]
    print(f"max_score({nums4}) = {max_score(nums4)}")  # Expected: 10
    
    # Test case 5: empty list
    nums5 = []
    print(f"max_score({nums5}) = {max_score(nums5)}")  # Expected: 0
