import { useEffect, useState } from "react";
import type { Donation } from "discrub-lib/types/discrub-types";
import { fetchDonationData } from "discrub-lib/github-service";

export function useDonations() {
  const [donations, setDonations] = useState<Donation[]>([]);

  useEffect(() => {
    const getDonationData = async () => {
      const data = await fetchDonationData();
      if (data?.length) {
        setDonations(data);
      }
    };
    getDonationData();
  }, []);

  return donations;
}
